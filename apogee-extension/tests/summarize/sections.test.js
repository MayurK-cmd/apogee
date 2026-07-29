import test from "node:test";
import assert from "node:assert";
import { splitIntoSections, chunkBySections } from "../../lib/summarize/sections.js";

test("splitIntoSections returns null for text with no headings", () => {
  const text =
    "This is an ordinary paragraph of prose. It runs on for a while.\n" +
    "Another line that is clearly not a heading, ending with a period.";
  assert.strictEqual(splitIntoSections(text), null);
});

test("splitIntoSections detects named and numbered scientific-paper headings", () => {
  const text = [
    "Abstract",
    "We present a new method.",
    "1 Introduction",
    "Prior work was limited.",
    "2. Methods",
    "We trained a model.",
    "3 Experimental Setup",
    "Details of the runs.",
    "References",
    "[1] Someone et al.",
  ].join("\n");

  const sections = splitIntoSections(text);
  assert.deepStrictEqual(
    sections.map((s) => s.heading),
    [
      "Abstract",
      "1 Introduction",
      "2. Methods",
      "3 Experimental Setup",
      "References",
    ],
  );
  assert.match(sections[2].text, /We trained a model/);
});

test("splitIntoSections keeps leading preamble as a null-heading section", () => {
  const text = [
    "Some intro text before any heading.",
    "Introduction",
    "Body.",
  ].join("\n");
  const sections = splitIntoSections(text);
  assert.strictEqual(sections[0].heading, null);
  assert.match(sections[0].text, /Some intro text/);
  assert.strictEqual(sections[1].heading, "Introduction");
});

test("splitIntoSections does not treat numbered sentences as headings", () => {
  const text = [
    "Introduction",
    "1. We then trained the model on a large corpus.",
    "2. The results were surprising in several respects.",
  ].join("\n");
  const sections = splitIntoSections(text);
  // Only the real "Introduction" heading, the numbered sentences stay body.
  assert.strictEqual(sections.length, 1);
  assert.strictEqual(sections[0].heading, "Introduction");
  assert.match(sections[0].text, /We then trained/);
});

test("splitIntoSections detects ALL-CAPS banner headings and markdown headings", () => {
  const text = ["## Overview", "Body one.", "RESULTS", "Body two."].join("\n");
  const sections = splitIntoSections(text);
  assert.deepStrictEqual(
    sections.map((s) => s.heading),
    ["Overview", "RESULTS"],
  );
});

test("chunkBySections falls back to plain chunking for unstructured text", () => {
  const text = "hello world";
  assert.deepStrictEqual(chunkBySections(text, 5), ["hello", "world"]);
});

test("chunkBySections keeps each chunk within the char budget and includes headings", () => {
  const body = "x ".repeat(60).trim(); // ~119 chars
  const text = ["Introduction", body, "Methods", body].join("\n");
  const chunks = chunkBySections(text, 200);
  for (const c of chunks)
    assert.ok(c.length <= 200, `chunk too big: ${c.length}`);
  const joined = chunks.join("\n");
  assert.match(joined, /Introduction/);
  assert.match(joined, /Methods/);
});

test("chunkBySections packs several small sections into one chunk under budget", () => {
  const text = ["Introduction", "a.", "Methods", "b.", "Results", "c."].join(
    "\n",
  );
  // Everything fits comfortably in one 1000-char chunk.
  const chunks = chunkBySections(text, 1000);
  assert.strictEqual(chunks.length, 1);
  assert.match(chunks[0], /Introduction/);
  assert.match(chunks[0], /Results/);
});

test("chunkBySections splits an oversized single section, keeping the heading on the first piece", () => {
  const bigBody = "word ".repeat(200).trim(); // ~999 chars
  const text = ["Methods", bigBody].join("\n");
  const chunks = chunkBySections(text, 300);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 300);
  assert.match(chunks[0], /Methods/);
});
