export function ortWasmUrl() {
  return chrome.runtime.getURL("assets/ort-wasm-simd-threaded.asyncify.wasm");
}

let _wasmBinaryPromise = null;
export function ortWasmBinary() {
  if (!_wasmBinaryPromise) {
    _wasmBinaryPromise = (async () => {
      const res = await fetch(ortWasmUrl());
      if (!res.ok) {
        throw new Error(`Failed to load bundled ONNX wasm (${res.status})`);
      }
      return res.arrayBuffer();
    })().catch((err) => {
      _wasmBinaryPromise = null;
      throw err;
    });
  }
  return _wasmBinaryPromise;
}
