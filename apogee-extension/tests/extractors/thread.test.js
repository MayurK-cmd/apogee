import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

function loadThread() {
  return loadExtractors({
    files: ["extractors/thread.js"],
    url: "https://example.com/",
    html: "<!doctype html><html><head><title>t</title></head><body></body></html>",
  });
}

const hasText = (n) => !!n.text;

test("directReplies counts only replies that survive eligibility", () => {
  const { buildThreadNodes, selectThreadComments, formatThreadComments } =
    loadThread();

  const nodes = buildThreadNodes([
    { depth: 0, author: "bob", text: "the parent" },
    { depth: 1, author: "carol", text: "a real reply" },
    { depth: 1, author: "dave", text: "" },
  ]);
  const kept = selectThreadComments(nodes, hasText, 10);

  assert.deepStrictEqual(
    kept.map((n) => n.author),
    ["bob", "carol"],
  );
  assert.match(formatThreadComments(kept), /\[1\] <replies: 1> bob:/);
});

test("a reply dropped for capacity still counts as a reply", () => {
  const { buildThreadNodes, selectThreadComments, formatThreadComments } =
    loadThread();

  const nodes = buildThreadNodes([
    { depth: 0, author: "bob", text: "the parent" },
    { depth: 1, author: "carol", text: "first reply" },
    { depth: 1, author: "erin", text: "second reply" },
  ]);
  const kept = selectThreadComments(nodes, hasText, 2);

  assert.deepStrictEqual(
    kept.map((n) => n.author),
    ["bob", "carol"],
  );
  assert.match(formatThreadComments(kept), /\[1\] <replies: 2> bob:/);
});
