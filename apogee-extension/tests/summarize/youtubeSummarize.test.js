import test from "node:test";
import assert from "node:assert";

import { summarizeYoutube } from "../../lib/summarize/youtubeSummarize.js";

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

test("summarizeYoutube skips the map stage for a single chunk and assembles straight from the transcript", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "final brief";
  }

  const result = await collect(
    summarizeYoutube(
      {
        text: "[0:00] intro [0:20] middle [0:45] outro",
        title: "My Video",
        url: "https://youtube.com/watch?v=abc",
      },
      {
        chunkTextFn: () => ["[0:00] intro [0:20] middle [0:45] outro"],
        chatStreamFn,
      },
    ),
  );

  assert.deepStrictEqual(result, ["final brief"]);
  assert.strictEqual(
    prompts.length,
    1,
    "only the assembly prompt should run, no map stage",
  );
  assert.match(prompts[0], /My Video/);
  // Last timestamp marker in the transcript is 0:45 == 45 seconds.
  assert.match(prompts[0], /45 seconds/);
});

test("summarizeYoutube runs a map pass per chunk then a single reduce/assembly pass", async () => {
  const calls = [];
  async function* chatStreamFn(_host, _model, prompt) {
    calls.push(prompt);
    yield `notes for: ${prompt.slice(0, 10)}`;
  }

  const progress = [];
  const result = await collect(
    summarizeYoutube(
      {
        text: "irrelevant, chunkTextFn stubbed below",
        title: "Multi-part Video",
        url: "https://youtube.com/watch?v=xyz",
      },
      {
        chunkTextFn: () => ["[0:00] part one", "[5:00] part two"],
        chatStreamFn,
        onProgress: (p) => progress.push(p),
      },
    ),
  );

  // Two map calls (one per chunk) plus one reduce/assembly call.
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(progress, [
    { stage: "map", index: 0, total: 2 },
    { stage: "map", index: 1, total: 2 },
    { stage: "reduce" },
  ]);
  // Final assembly prompt should carry the video title and see both chunks' notes.
  assert.match(calls[2], /Multi-part Video/);
  assert.match(calls[2], /notes for:/);
});

test("summarizeYoutube passes mode through to the assembly prompt's summary style", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "brief";
  }

  await collect(
    summarizeYoutube(
      {
        text: "[0:00] hello world",
        title: "My Video",
        url: "https://youtube.com/watch?v=abc",
        mode: "paragraphs",
      },
      {
        chunkTextFn: () => ["[0:00] hello world"],
        chatStreamFn,
      },
    ),
  );

  assert.match(
    prompts[0],
    /Output one concise paragraph containing 10-15 sentences/,
  );
});

test("summarizeYoutube assembles a chaptered brief when the content carries a Chapters block", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "brief";
  }

  const text = [
    "Video Title:",
    "My Talk",
    "",
    "Chapters:",
    "- [0:00] Intro",
    "- [0:30] Middle",
    "- [1:00] Wrap up",
    "",
    "Transcript:",
    "[0:00] hi [0:30] mid [1:00] bye",
  ].join("\n");

  await collect(
    summarizeYoutube(
      {
        text,
        title: "My Talk",
        url: "https://youtube.com/watch?v=abc",
        // mode is ignored for a chaptered brief; it has its own fixed shape.
        mode: "paragraphs",
      },
      { chunkTextFn: (t) => [t], chatStreamFn },
    ),
  );

  // Brief structure, not the flat paragraphs style.
  assert.match(prompts[0], /## Overview/);
  assert.match(prompts[0], /\*\*Key Takeaways\*\*/);
  assert.match(prompts[0], /Intro/);
  assert.match(prompts[0], /Wrap up/);
  assert.doesNotMatch(
    prompts[0],
    /Output one concise paragraph containing 10-15 sentences/,
  );
  // Deterministic jump link for the 1:00 chapter (60s).
  assert.match(prompts[0], /watch\?v=abc&t=60s/);
  // The raw "Chapters:" block is stripped from the transcript notes region.
  assert.doesNotMatch(prompts[0], /- \[0:30\] Middle/);
});

test("summarizeYoutube stops issuing new model calls once the signal is aborted between chunks", async () => {
  const controller = new AbortController();
  let calls = 0;
  // eslint-disable-next-line require-yield
  async function* chatStreamFn() {
    calls += 1;
    controller.abort();
  }

  const result = await collect(
    summarizeYoutube(
      {
        text: "irrelevant",
        title: "t",
        url: "https://youtube.com/watch?v=abc",
        signal: controller.signal,
      },
      {
        chunkTextFn: () => ["chunk one", "chunk two", "chunk three"],
        chatStreamFn,
      },
    ),
  );

  assert.deepStrictEqual(result, []);
  assert.strictEqual(
    calls,
    1,
    "should not call the model for chunk two/three or the reduce merge after abort",
  );
});

test("summarizeYoutube truncates to the chunk cap instead of growing chunks past the context budget", async () => {
  // A cleanedContent long enough that chunkTextFn (called with the default
  // model's ~24576-char budget) returns >12 chunks. The old behavior
  // re-chunked at content/12 and doubled from there, growing chunks without
  // bound past the model's context budget; now the tail is dropped instead:
  // exactly one chunkTextFn call (never with a bigger size), the map phase
  // capped at 12 chunks, and a one-shot truncated progress event.
  // (undefined model -> getMaxChunkChars falls back to the default Ollama
  // budget, ~24576 chars; 300000 chars / 24576 > 12.)
  const longText = "x".repeat(300000);
  const chunkCalls = [];
  const chunkTextFn = (text, maxChars) => {
    chunkCalls.push(maxChars);
    const n = Math.ceil(text.length / maxChars);
    return Array.from({ length: n }, () => "x");
  };

  let mapCalls = 0;
  async function* chatStreamFn() {
    mapCalls++;
    yield "x";
  }

  const progressEvents = [];
  await collect(
    summarizeYoutube(
      { text: longText, title: "t", url: "https://youtube.com/watch?v=abc" },
      { chunkTextFn, chatStreamFn, onProgress: (p) => progressEvents.push(p) },
    ),
  );

  assert.strictEqual(chunkCalls.length, 1, "should never re-chunk bigger");
  const truncated = progressEvents.filter((p) => p.stage === "truncated");
  assert.strictEqual(truncated.length, 1);
  assert.strictEqual(truncated[0].kept, 12);
  assert.ok(truncated[0].total > 12);
  // 12 map calls + the final assembly call.
  assert.strictEqual(mapCalls, 13);
});
