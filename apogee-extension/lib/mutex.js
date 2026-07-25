// A simple promise-chain mutex. `createLock()` returns an `acquire()` that
// resolves once the previous holder releases; await it, then call the returned
// release function when done (typically in a finally). Shared by offscreen.js
// (serializing WebLLM/WebGPU engine operations, which corrupt the device
// context if overlapped) and transformersEngine.js (same, for the ONNX/WASM
// engine on Firefox).
export function createLock() {
  let lock = Promise.resolve();
  return async function acquire() {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const previous = lock;
    lock = next;
    await previous;
    return release;
  };
}
