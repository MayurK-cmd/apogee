import test from "node:test";
import assert from "node:assert/strict";
import { loadExtractors } from "./helpers/extractorHarness.js";

test("Lemmy extractor: parses post title, author, community, body, and comments", () => {
  const { extractLemmy } = loadExtractors({
    files: ["extractors/thread.js", "extractors/lemmy.js"],
    url: "https://lemmy.world/post/12345",
    fixture: "lemmy-post.html",
  });

  const result = extractLemmy();

  assert.equal(result.type, "lemmy");
  assert.equal(
    result.title,
    "Lemmy: What are your favorite privacy-focused browser extensions?",
  );
  assert.equal(result.url, "https://lemmy.world/post/12345");

  assert.match(
    result.content,
    /Title: What are your favorite privacy-focused browser extensions\?/,
  );
  assert.match(result.content, /Author: alice/);
  assert.match(result.content, /Community: \/c\/privacy/);
  assert.match(result.content, /Score: 42/);
  assert.match(result.content, /Looking for recommendations on browser tools/);

  assert.match(
    result.content,
    /\[1\] <replies: 1> \(score: 15\) bob: uBlock Origin is an essential first install/,
  );
  assert.match(
    result.content,
    /\[1\.1\] \(score: 7\) charlie: Agreed! Combined with medium mode/,
  );
});

test("Lemmy extractor: returns null for community listings and non-post pages", () => {
  const { extractLemmy } = loadExtractors({
    files: ["extractors/thread.js", "extractors/lemmy.js"],
    url: "https://lemmy.world/c/privacy",
    fixture: "lemmy-post.html",
  });

  const result = extractLemmy();
  assert.equal(result, null);
});
