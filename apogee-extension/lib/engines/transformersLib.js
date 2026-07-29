// Memoized dynamic import of @huggingface/transformers, shared by
// embeddings.js (the on-device embedding pipeline, loaded in the offscreen
// document) and transformersEngine.js (Firefox's in-browser text-generation
// provider, loaded in the background page). The dynamic import keeps this
// ~9 MB dependency out of the importing module's initial bundle/eviction path
// (mirrors offscreen.js's getWebLLM()); it only actually loads once per
// execution context on first use.
let _transformers = null;

export async function getTransformers() {
  if (!_transformers) {
    _transformers = await import("@huggingface/transformers");
  }
  return _transformers;
}
