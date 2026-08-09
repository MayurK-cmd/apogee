let _transformers = null;

export async function getTransformers() {
  if (!_transformers) {
    _transformers = await import("@huggingface/transformers");
  }
  return _transformers;
}
