// Shared Transformers.js (ONNX/WASM) text-generation engine plumbing, used
// only on Firefox as its in-browser provider (see PROVIDERS in
// lib/constants.js). Runs directly in background/service-worker.js
// (Firefox's background page, which, unlike Chrome's real service worker, has
// a window/DOM context and can dynamic-import it) because, unlike wllama,
// @huggingface/transformers's WASM backend never spawns a dedicated Worker
// (onnxruntime-web's own env.wasm.proxy is hardcoded false by the library),
// so it isn't affected by the blob:-URL-worker CSP restriction that blocks
// wllama in every extension execution context on both browsers.

import { debugLog } from "../util/log.js";
import {
  TRANSFORMERS_MODELS,
  EXPERIMENTAL_WASM_THREADS,
} from "../constants.js";
import { getTransformers } from "./transformersLib.js";
import { ortWasmUrl, ortWasmBinary } from "./onnxWasm.js";
import { createLock } from "../util/mutex.js";

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

// EXPERIMENTAL multi-threaded-WASM probe. Logs the cross-origin-isolation state
// on every engine load, so a single reload reveals whether SharedArrayBuffer
// (and therefore onnxruntime WASM threads) is even reachable in this extension
// context, and only actually requests threads when EXPERIMENTAL_WASM_THREADS
// is on AND isolation is present. onnxruntime silently falls back to a single
// thread when SharedArrayBuffer is missing, so requesting >1 here is harmless;
// the flag just lets us watch whether pthread workers spawn or hit the
// worker-CSP wall that blocked wllama. Capped at 4 to avoid oversubscribing.
// Returns the numThreads to hand env.backends.onnx.wasm.
function resolveWasmThreads(label) {
  const isolated = globalThis.crossOriginIsolated === true;
  const hasSAB = typeof SharedArrayBuffer !== "undefined";
  const cores = globalThis.navigator?.hardwareConcurrency || 1;
  const threads =
    EXPERIMENTAL_WASM_THREADS && isolated && hasSAB ? Math.min(cores, 4) : 1;
  debugLog(
    `[mt] ${label}: crossOriginIsolated=${isolated} ` +
      `SharedArrayBuffer=${hasSAB} cores=${cores} ` +
      `flag=${EXPERIMENTAL_WASM_THREADS} -> numThreads=${threads}`,
  );
  return threads;
}

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

  debugLog(`[transformers] ensureEngine: loading ${modelId}`);
  const { pipeline, env } = await getTransformers();
  debugLog("[transformers] library loaded, preparing WASM backend");
  // Single-threaded unless the EXPERIMENTAL multi-thread flag is on AND this
  // context turns out to be cross-origin-isolated (see resolveWasmThreads).
  env.backends.onnx.wasm.numThreads = resolveWasmThreads("text-gen");
  // Bundled-in-package WASM runtime, instantiated from raw bytes (wasmBinary)
  // rather than fetched by onnxruntime; see lib/onnxWasm.js and lib/embeddings.js
  // for the full rationale (streaming instantiation of an extension-served .wasm
  // hangs; wasmPaths is kept only to suppress transformers.js's jsDelivr default).
  env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl() };
  env.backends.onnx.wasm.wasmBinary = await ortWasmBinary();
  debugLog("[transformers] WASM binary ready, building pipeline");

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
  debugLog(`[transformers] pipeline ready for ${modelId}`);

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

// --- Opus-MT translation pipeline (opt-in "opus" translationEngine) ---
// A separate seq2seq `translation` pipeline, cached and locked independently of
// the text-generation engine above (a summarize/ask job may use both: the LLM
// generates, then this translates the result, see lib/languageOutput.js). Same
// bundled-WASM setup as ensureEngine; Opus-MT models are small (~80MB direct
// pairs) and English-centric (see lib/opusTranslate.js for model resolution).
let translator = null;
let translatorModelId = null;
const acquireTranslatorLock = createLock();

async function ensureTranslator(modelId, onProgress) {
  if (translator && translatorModelId === modelId) return translator;
  if (translator) {
    try {
      await translator.dispose();
    } catch {
      // ignore
    }
    translator = null;
    translatorModelId = null;
  }
  const { pipeline, env } = await getTransformers();
  env.backends.onnx.wasm.numThreads = resolveWasmThreads("translator");
  env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl() };
  env.backends.onnx.wasm.wasmBinary = await ortWasmBinary();
  translator = await pipeline("translation", modelId, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status !== "progress") return;
      onProgress?.({
        progress: p.progress / 100,
        text: `Downloading translation model... ${Math.round(p.progress)}%`,
      });
    },
  });
  translatorModelId = modelId;
  return translator;
}

export async function withTranslator(modelId, onProgress, fn) {
  const release = await acquireTranslatorLock();
  try {
    const t = await ensureTranslator(modelId, onProgress);
    return await fn(t);
  } catch (err) {
    // Drop a broken translator so the next attempt reloads it cleanly.
    if (translator) {
      try {
        Promise.resolve(translator.dispose()).catch(() => {});
      } catch {
        // ignore
      }
    }
    translator = null;
    translatorModelId = null;
    throw err;
  } finally {
    release();
  }
}

// Cap decode length per translated line. Opus-MT can degenerate into a
// repetition loop on odd input (bare numbers, markdown, code fragments) and
// run to the model's full max_length, which on single-threaded WASM stalls the
// whole translate pass and reads as a frozen extension, the same failure mode
// GENERATION_MAX_TOKENS guards on the text-gen engine. Summary lines are
// sentence-length, so this is generous headroom rather than a real limit.
const TRANSLATE_MAX_NEW_TOKENS = 256;

// Translates a batch of strings in a single seq2seq pass. transformers.js
// batches internally, so this is far faster than awaiting one call per line on
// single-threaded WASM. `token` is the grouped-model ">>xxx<< " target prefix,
// prepended to every input (empty for a dedicated per-pair model); Opus-MT
// needs no src/tgt_lang args, the model (or its token) fixes the direction.
// Returns translations in input order.
//
// num_beams: 1 forces greedy decoding. Marian/Opus-MT models ship a
// generation_config with beam search on (num_beams 4-6), which does ~4-6x the
// decoder forward passes for a marginal BLEU gain, far too costly on
// single-threaded WASM, where decode is the whole runtime. Greedy is the right
// trade for summary text; bump num_beams back up here to trade speed for quality.
export async function translateBatch(t, texts, token = "") {
  if (!texts.length) return [];
  const output = await t(
    texts.map((x) => token + x),
    {
      max_new_tokens: TRANSLATE_MAX_NEW_TOKENS,
      num_beams: 1,
      do_sample: false,
    },
  );
  const arr = Array.isArray(output) ? output : [output];
  return arr.map((o) => o?.translation_text ?? "");
}

// Bridges TextStreamer's callback-based streaming into an async generator,
// the same queue/wake pattern lib/providers.js's attachToStream uses to
// bridge port messages into an async generator. Takes a plain prompt string
// (wrapped into a single-turn chat message here) to match the chatStreamFn
// seam summarizeText (lib/ollamaSummarize.js) expects.
export async function* transformersChatStream(eng, prompt, { system } = {}) {
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
        debugLog("[transformers] first token emitted");
        firstToken = false;
      }
      if (text) queue.push(text);
      wake();
    },
  });

  debugLog(`[transformers] generation start (prompt ${prompt.length} chars)`);
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];
  eng(messages, {
    max_new_tokens: GENERATION_MAX_TOKENS,
    do_sample: false,
    streamer,
  })
    .then(() => {
      debugLog("[transformers] generation resolved");
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
