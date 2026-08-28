import { debugLog } from "../util/log.js";
import {
  TRANSFORMERS_MODELS,
  EXPERIMENTAL_WASM_THREADS,
} from "../constants.js";
import { getTransformers } from "./transformersLib.js";
import { ortWasmUrl, ortWasmBinary } from "./onnxWasm.js";
import { createLock } from "../util/mutex.js";

const GENERATION_MAX_TOKENS = 640;

let engine = null;
let currentModelId = null;
let loadingModelId = null;

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

const acquireLock = createLock();

async function ensureEngine(modelId, onProgress) {
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine) {
    try {
      await engine.dispose();
    } catch {
      // Safe fallback: ignore disposal errors when replacing an existing engine
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
  env.backends.onnx.wasm.numThreads = resolveWasmThreads("text-gen");
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

function resetEngineState() {
  if (engine) {
    const stale = engine;
    try {
      Promise.resolve(stale.dispose()).catch(() => {});
    } catch {
      // Safe fallback: best-effort cleanup of stale model engine
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

let translator = null;
let translatorModelId = null;
const acquireTranslatorLock = createLock();

async function ensureTranslator(modelId, onProgress) {
  if (translator && translatorModelId === modelId) return translator;
  if (translator) {
    try {
      await translator.dispose();
    } catch {
      // Safe fallback: ignore disposal errors when replacing translator engine
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
    if (translator) {
      try {
        Promise.resolve(translator.dispose()).catch(() => {});
      } catch {
        // Safe fallback: best-effort cleanup of failed translator
      }
    }
    translator = null;
    translatorModelId = null;
    throw err;
  } finally {
    release();
  }
}

const TRANSLATE_MAX_NEW_TOKENS = 256;

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
