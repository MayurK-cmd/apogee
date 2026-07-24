import test from "node:test";
import assert from "node:assert";

import { summarizeYoutube } from "../lib/youtubeSummarize.js";

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

test("summarizeYoutube re-chunks with a bigger size when the model's max chunk size would exceed MAX_CHUNKS", async () => {
  // A cleanedContent long enough that chunkTextFn (called with the default
  // model's ~24576-char budget first) returns >12 chunks, forcing the
  // doubling loop to kick in until a chunkTextFn call returns <= MAX_CHUNKS
  // chunks. (undefined model -> getMaxChunkChars falls back to the default
  // Ollama budget, ~24576 chars; 300000 chars / 24576 > 12.)
  const longText = "x".repeat(300000);
  const chunkCalls = [];
  const chunkTextFn = (text, maxChars) => {
    chunkCalls.push(maxChars);
    const n = Math.ceil(text.length / maxChars);
    return Array.from({ length: n }, () => "x");
  };

  async function* chatStreamFn() {
    yield "x";
  }

  await collect(
    summarizeYoutube(
      { text: longText, title: "t", url: "https://youtube.com/watch?v=abc" },
      { chunkTextFn, chatStreamFn },
    ),
  );

  assert.ok(chunkCalls.length > 1, "should retry chunking with a bigger size");
  assert.ok(
    chunkCalls[chunkCalls.length - 1] > chunkCalls[0],
    "chunk size should grow on each retry",
  );
});
