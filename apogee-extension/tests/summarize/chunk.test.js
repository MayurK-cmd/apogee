import test from "node:test";
import assert from "node:assert";
import {
  chunkText,
  truncateForPrompt,
  chunkTextOverview,
} from "../../lib/summarize/chunk.js";

test("chunkText splits text within maxChars limits", () => {
  const text = "hello world";
  const chunks = chunkText(text, 5);
  assert.deepEqual(chunks, ["hello", "world"]);
});

test("chunkText returns empty array for empty inputs", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText(null), []);
});

test("truncateForPrompt truncates correctly", () => {
  const text = "This is a long string";
  const result = truncateForPrompt(text, 10);
  assert.ok(result.includes("[...content truncated...]"));
  assert.ok(result.length <= 10 + 28);
});

test("chunkTextOverview limits total chunks for large documents", () => {
  const text = "chunk1. chunk2. chunk3. chunk4. chunk5. chunk6. chunk7.";
  const overview = chunkTextOverview(text, 7, 3);
  assert.ok(overview.length <= 3);
  assert.strictEqual(overview[0], "chunk1.");
});
