// Shared Transformers.js (ONNX/WASM) text-generation engine plumbing, used
// only on Firefox as its in-browser provider (see PROVIDERS in
// lib/constants.js). Runs directly in background/service-worker.js
// (Firefox's background page, which, unlike Chrome's real service worker, has
// a window/DOM context and can dynamic-import it) because, unlike wllama,
// @huggingface/transformers's WASM backend never spawns a dedicated Worker
// (onnxruntime-web's own env.wasm.proxy is hardcoded false by the library),
// so it isn't affected by the blob:-URL-worker CSP restriction that blocks
// wllama in every extension execution context on both browsers.

import { TRANSFORMERS_MODELS } from "./constants.js";
import { getTransformers } from "./transformersLib.js";
import { ortWasmUrl, ortWasmBinary } from "./onnxWasm.js";
import { createLock } from "./mutex.js";

// Hard cap on new tokens per generation call. Deliberately far below
// WebLLM's 2048: this engine decodes at roughly a token per second
// (single-threaded WASM, SmolLM2-360M q4f16, measured 2026-07-25), so an
// uncapped rambling pass ran for up to half an hour and read as a frozen
// extension. 640 comfortably covers every summary style (bullets' scaled
// reduce included) and Ask answers.
const GENERATION_MAX_TOKENS = 640;

let engine = null;
let currentModelId = null;
let loadingModelId = null;

// Serializes engine operations so a load/generate can't overlap and corrupt
// the ONNX/WASM engine state (see lib/mutex.js; mirrors offscreen.js's WebLLM
// engine lock).
const acquireLock = createLock();

async function ensureEngine(modelId, onProgress) {
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine) {
    try {
      await engine.dispose();
    } catch {
      // ignore
    }
    engine = null;
    currentModelId = null;
  }

  const modelInfo = TRANSFORMERS_MODELS.find((m) => m.id === modelId);
  if (!modelInfo) {
    throw new Error(`Unknown Transformers.js model: ${modelId}`);
  }

  loadingModelId = modelId;

  console.log(`[transformers] ensureEngine: loading ${modelId}`);
  const { pipeline, env } = await getTransformers();
  console.log("[transformers] library loaded, preparing WASM backend");
  // Extension pages aren't cross-origin-isolated, so multi-threaded WASM
  // (which needs SharedArrayBuffer) isn't available anyway; forcing
  // single-threaded up front skips onnxruntime-web's feature probe, same as
  // lib/embeddings.js.
  env.backends.onnx.wasm.numThreads = 1;
  // Bundled-in-package WASM runtime, instantiated from raw bytes (wasmBinary)
  // rather than fetched by onnxruntime; see lib/onnxWasm.js and lib/embeddings.js
  // for the full rationale (streaming instantiation of an extension-served .wasm
  // hangs; wasmPaths is kept only to suppress transformers.js's jsDelivr default).
  env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl() };
  env.backends.onnx.wasm.wasmBinary = await ortWasmBinary();
  console.log("[transformers] WASM binary ready, building pipeline");

  engine = await pipeline("text-generation", modelInfo.id, {
    dtype: modelInfo.dtype,
    device: "wasm",
    progress_callback: (p) => {
      if (p.status !== "progress") return;
      onProgress?.({
        progress: p.progress / 100,
        text: `Downloading model... ${Math.round(p.progress)}%`,
      });
    },
  });
  console.log(`[transformers] pipeline ready for ${modelId}`);

  currentModelId = modelId;
  loadingModelId = null;
  return engine;
}

// ensureEngine's fast path trusts currentModelId and hands back the cached
// engine without checking it's still healthy; any caller that touches the
// engine must go through withEngine so a failure forces a full reload next
// time (mirrors offscreen.js's WebLLM resetEngineState/withEngine).
// Disposes the old engine before dropping the reference: without that, an
// errored engine's WASM heap (hundreds of MB of model weights) stayed
// allocated for the life of the background page while a replacement engine
// loaded alongside it. Fire-and-forget so a failing dispose can't mask the
// error that got us here.
function resetEngineState() {
  if (engine) {
    const stale = engine;
    try {
      Promise.resolve(stale.dispose()).catch(() => {});
    } catch {
      // ignore
    }
  }
  engine = null;
  currentModelId = null;
  loadingModelId = null;
}

export async function withTransformersEngine(modelId, onProgress, fn) {
  const release = await acquireLock();
  try {
    const eng = await ensureEngine(modelId, onProgress);
    return await fn(eng);
  } catch (err) {
    resetEngineState();
    throw err;
  } finally {
    release();
  }
}

export function getTransformersStatus() {
  return { currentModelId, loadingModelId };
}

// Bridges TextStreamer's callback-based streaming into an async generator,
// the same queue/wake pattern lib/providers.js's attachToStream uses to
// bridge port messages into an async generator. Takes a plain prompt string
// (wrapped into a single-turn chat message here) to match the chatStreamFn
// seam summarizeText (lib/ollamaSummarize.js) expects.
export async function* transformersChatStream(eng, prompt) {
  const { TextStreamer } = await getTransformers();
  const queue = [];
  let resolveNext = null;
  let done = false;
  let streamError = null;

  function wake() {
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  }

  let firstToken = true;
  const streamer = new TextStreamer(eng.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      if (firstToken) {
        console.log("[transformers] first token emitted");
        firstToken = false;
      }
      if (text) queue.push(text);
      wake();
    },
  });

  console.log(`[transformers] generation start (prompt ${prompt.length} chars)`);
  eng([{ role: "user", content: prompt }], {
    max_new_tokens: GENERATION_MAX_TOKENS,
    do_sample: false,
    streamer,
  })
    .then(() => {
      console.log("[transformers] generation resolved");
    })
    .catch((err) => {
      console.error("[transformers] generation error:", err);
      streamError = err;
    })
    .finally(() => {
      done = true;
      wake();
    });

  while (true) {
    if (queue.length > 0) {
      yield queue.shift();
    } else if (streamError) {
      throw streamError;
    } else if (done) {
      break;
    } else {
      await new Promise((resolve) => {
        resolveNext = resolve;
      });
    }
  }
}

export async function transformersGenerateText(eng, prompt, maxTokens = 512) {
  const output = await eng([{ role: "user", content: prompt }], {
    max_new_tokens: maxTokens,
    do_sample: false,
  });
  return output[0]?.generated_text?.at(-1)?.content || "";
}
