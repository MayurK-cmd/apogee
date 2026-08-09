import test from "node:test";
import assert from "node:assert";

import {
  getMaxChunkChars,
  getMaxChunks,
} from "../../lib/engines/modelLimits.js";
import { TRANSFORMERS_MODELS } from "../../lib/constants.js";

test("getMaxChunkChars caps WebLLM's uniformly small context window", () => {
  assert.equal(getMaxChunkChars("Qwen2.5-1.5B-Instruct-q4f16_1-MLC"), 8192);
  assert.equal(getMaxChunkChars("Phi-3.5-mini-instruct-q4f16_1-MLC"), 8192);
});

test("getMaxChunkChars gives large-context Ollama models more room, capped in practice", () => {
  assert.equal(getMaxChunkChars("llama3.1:8b"), 87808);
  assert.equal(getMaxChunkChars("llama3.1:70b-instruct-q4_0"), 87808);
});

test("getMaxChunkChars matches the longer, more specific model-family prefix first", () => {
  assert.equal(getMaxChunkChars("qwen2.5:7b"), 87808);
  assert.notEqual(getMaxChunkChars("qwen2.5:7b"), getMaxChunkChars("qwen:7b"));
});

test("getMaxChunkChars gives a smaller-context Ollama family less room than a large one", () => {
  assert.equal(getMaxChunkChars("mistral:latest"), 24576);
});

test("getMaxChunkChars falls back to a conservative default for an unrecognized model", () => {
  assert.equal(getMaxChunkChars("some-custom-finetune:latest"), 24576);
});

test("getMaxChunkChars caps Transformers.js's WASM/CPU budget below even WebLLM's", () => {
  for (const model of TRANSFORMERS_MODELS) {
    assert.equal(getMaxChunkChars(model.id), 4096);
  }
});

test("getMaxChunks fans Transformers.js models out into far fewer chunks", () => {
  for (const model of TRANSFORMERS_MODELS) {
    assert.equal(getMaxChunks(model.id), 4);
  }
  assert.equal(getMaxChunks("Qwen2.5-1.5B-Instruct-q4f16_1-MLC"), 12);
  assert.equal(getMaxChunks("llama3.1:8b"), 12);
});
