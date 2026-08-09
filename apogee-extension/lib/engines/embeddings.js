import { getTransformers } from "./transformersLib.js";
import { ortWasmUrl, ortWasmBinary } from "./onnxWasm.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let _extractorPromise = null;
async function getExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline, env } = await getTransformers();
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl() };
      env.backends.onnx.wasm.wasmBinary = await ortWasmBinary();
      return pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
        device: "wasm",
      });
    })().catch((err) => {
      _extractorPromise = null;
      throw err;
    });
  }
  return _extractorPromise;
}

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
