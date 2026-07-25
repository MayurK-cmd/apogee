// Resolves the extension-local URL of onnxruntime-web's WASM runtime, which is
// bundled into the package (see the ort-wasm rule in vite.config.js) rather
// than fetched from a CDN at runtime. Shipping it locally closes a
// supply-chain hole (no unverified remote WASM in the inference path of a
// privacy-first extension) and keeps the package free of remotely loaded code,
// which both the Chrome Web Store and AMO prohibit.
//
// The filename must match onnxruntime-web's own WASM binary (emitted verbatim
// by Rollup, hash-free, via vite.config.js's assetFileNames rule). Re-check it
// when upgrading @huggingface/transformers / onnxruntime-web; a mismatch means
// getURL() resolves to a 404 and the engine fails to load.
//
// chrome.runtime.getURL works in both consumers' execution contexts: the
// offscreen document (lib/embeddings.js) and Firefox's background page
// (lib/transformersEngine.js). `chrome` is present as an alias for `browser`
// on Firefox too, matching how the rest of the codebase calls it.
//
// Resolved lazily (not at module load) so importing the embedding/engine
// module graph outside a browser, e.g. the Node test suite, doesn't touch
// the `chrome` global, which only exists at inference time anyway.
export function ortWasmUrl() {
  return chrome.runtime.getURL("assets/ort-wasm-simd-threaded.asyncify.wasm");
}

// Fetches the bundled wasm as raw bytes so onnxruntime can instantiate it
// directly via env.wasm.wasmBinary, instead of letting onnxruntime fetch the
// URL itself with WebAssembly.instantiateStreaming(). Streaming instantiation
// of an *extension-served* .wasm hangs/fails in practice: the extension
// resource server doesn't reliably satisfy instantiateStreaming's
// application/wasm requirement, and it's worse on moz-extension://, which left
// the engine wedged right after the model finished downloading (see the
// wasmBinary docs in onnxruntime-common's env.d.ts: when set, wasmPaths is
// ignored for the binary). Memoized: the ~23 MB fetch happens once per context.
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
      // Drop the memo so a later attempt can retry instead of reusing the
      // rejected promise forever.
      _wasmBinaryPromise = null;
      throw err;
    });
  }
  return _wasmBinaryPromise;
}
