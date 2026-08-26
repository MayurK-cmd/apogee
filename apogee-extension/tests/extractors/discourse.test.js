import test from "node:test";
import assert from "node:assert/strict";
import { loadExtractors } from "./helpers/extractorHarness.js";

test("Discourse extractor: parses topic title, OP author, category, body, and replies", () => {
  const { extractDiscourse } = loadExtractors({
    files: ["extractors/thread.js", "extractors/discourse.js"],
    url: "https://forum.golang.org/t/how-to-optimize-wasm/1234",
    fixture: "discourse-topic.html",
  });

  const result = extractDiscourse();

  assert.equal(result.type, "discourse");
  assert.equal(
    result.title,
    "Discourse: How to optimize WebAssembly binary size?",
  );
  assert.equal(
    result.url,
    "https://forum.golang.org/t/how-to-optimize-wasm/1234",
  );

  assert.match(
    result.content,
    /Title: How to optimize WebAssembly binary size\?/,
  );
  assert.match(result.content, /Author: dave/);
  assert.match(result.content, /Category: Performance/);
  assert.match(result.content, /We are compiling C\+\+ modules to WebAssembly/);

  assert.match(
    result.content,
    /\[1\] \(score: 12\) eve: Use `-Oz` optimization in Emscripten/,
  );
});

test("Discourse extractor: returns null for category listings and non-topic pages", () => {
  const { extractDiscourse } = loadExtractors({
    files: ["extractors/thread.js", "extractors/discourse.js"],
    url: "https://forum.golang.org/c/performance",
    fixture: "discourse-topic.html",
  });

  const result = extractDiscourse();
  assert.equal(result, null);
});
