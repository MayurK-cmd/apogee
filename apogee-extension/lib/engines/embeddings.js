// Local text-embedding pipeline used for retrieval-augmented "Ask" answers
// (see lib/rag.js). Runs a small quantized sentence-embedding model via
// @huggingface/transformers (WASM/onnxruntime-web) entirely on-device, no
// network calls beyond fetching the public model weights once (same trust
// tier as WebLLM's own model downloads, already allowed by manifest CSP).
//
// Only ever loaded from offscreen.js (directly, or via the direct-Ollama
// "ask" relay in background/service-worker.js, see getRelevantAskContent
// there): dynamic import() support inside a ServiceWorkerGlobalScope has
// been unreliable in Chrome MV3 (long rejected per spec, and Vite's preload
// helper additionally assumed a `window`, see vite.config.js's modulePreload
// note), so the offscreen document, a real Document context, is the
// verified-working home for this pipeline.
// getTransformers (see lib/transformersLib.js) mirrors offscreen.js's
// getWebLLM(): its dynamic import keeps this ~9 MB dependency out of the
// importing module's initial bundle/eviction path (offscreen.js registers its
// message handlers before either loads).

import { getTransformers } from "./transformersLib.js";
import { ortWasmUrl, ortWasmBinary } from "./onnxWasm.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let _extractorPromise = null;
async function getExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline, env } = await getTransformers();
      // Extensions pages aren't cross-origin-isolated, so multi-threaded WASM
      // (which needs SharedArrayBuffer) isn't available anyway; forcing
      // single-threaded up front skips onnxruntime-web's feature probe. The
      // model is tiny enough that the throughput cost doesn't matter here.
      env.backends.onnx.wasm.numThreads = 1;
      // Instantiate onnxruntime's WASM runtime from the bundled binary's raw
      // bytes (see lib/onnxWasm.js's ortWasmBinary) rather than letting it fetch
      // the URL itself: streaming instantiation of an extension-served .wasm
      // hangs. wasmPaths is still set so transformers.js doesn't fall back to
      // its jsDelivr default (which would import the wasm glue remotely, blocked
      // by script-src); with wasmBinary set, wasmPaths is otherwise ignored for
      // the binary. Deliberately no `.mjs`: onnxruntime-web's JS glue resolves
      // from its normal bundled path, same-origin.
      env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl() };
      env.backends.onnx.wasm.wasmBinary = await ortWasmBinary();
      return pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
        device: "wasm",
      });
    })().catch((err) => {
      // Drop the memo so a transient failure (e.g. a model-weights or WASM
      // fetch blip on first use) can be retried, instead of poisoning every
      // later Ask/highlight-in-page with the same rejected promise for the
      // life of the offscreen document. Mirrors ortWasmBinary in onnxWasm.js.
      _extractorPromise = null;
      throw err;
    });
  }
  return _extractorPromise;
}

/**
 * Embeds a batch of strings, returning one normalized vector (plain number
 * array) per input, in the same order. Mean-pooled + L2-normalized, so
 * cosine similarity between two results reduces to a plain dot product
 * (see dot() below).
 */
export async function embedTexts(texts) {
  if (!texts || texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
