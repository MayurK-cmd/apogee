// The shared thread representation, tested directly rather than through a site
// extractor. thread.js isn't a module either, so the harness loads it the same
// way, just without a second file after it.

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
    { depth: 1, author: "dave", text: "" }, // deleted/flagged: no body
  ]);
  const kept = selectThreadComments(nodes, hasText, 10);

  assert.deepStrictEqual(
    kept.map((n) => n.author),
    ["bob", "carol"],
  );
  // Not 2. A body-less stub is not a reply, and claiming one above a single
  // rendered reply invites the model to describe a comment it never saw.
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
  // Two slots for three eligible comments, so one real reply gets cut.
  const kept = selectThreadComments(nodes, hasText, 2);

  assert.deepStrictEqual(
    kept.map((n) => n.author),
    ["bob", "carol"],
  );
  // Still 2. Eligibility says what counts as a comment; the cap only says how
  // many fit. On big threads the reply count is the signal pointing the model
  // at where the argument happened, so trimming for space must not erase it.
  assert.match(formatThreadComments(kept), /\[1\] <replies: 2> bob:/);
});
