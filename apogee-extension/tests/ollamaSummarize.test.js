import test from "node:test";
import assert from "node:assert";

import { summarizeText } from "../lib/ollamaSummarize.js";

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

test("summarizeText (paragraphs) stops issuing new model calls once the signal is aborted between chunks", async () => {
  const controller = new AbortController();
  let calls = 0;
  // eslint-disable-next-line require-yield
  async function* chatStreamFn() {
    calls += 1;
    // Aborts after the first chunk's own call has already started, mirroring
    // a cancel click landing mid-map-phase.
    controller.abort();
  }

  const result = await collect(
    summarizeText(
      { text: "irrelevant", mode: "paragraphs", signal: controller.signal },
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

test("summarizeText (bullets) stops issuing new model calls once the signal is aborted between chunks", async () => {
  const controller = new AbortController();
  let calls = 0;
  async function* chatStreamFn() {
    calls += 1;
    if (calls === 1) {
      yield "- first bullet\n";
      controller.abort();
    }
  }

  const result = await collect(
    summarizeText(
      { text: "irrelevant", mode: "bullets", signal: controller.signal },
      {
        chunkTextFn: () => ["chunk one", "chunk two"],
        chatStreamFn,
      },
    ),
  );

  assert.deepStrictEqual(result, ["- first bullet\n"]);
  assert.strictEqual(
    calls,
    1,
    "should not call the model for chunk two after abort",
  );
});

test("summarizeText (paragraphs) runs every chunk plus the reduce merge when never aborted", async () => {
  let calls = 0;
  async function* chatStreamFn(_host, _model, prompt) {
    calls += 1;
    yield `summary of: ${prompt}`;
  }

  const result = await collect(
    summarizeText(
      { text: "irrelevant", mode: "paragraphs" },
      {
        chunkTextFn: () => ["chunk one", "chunk two"],
        chatStreamFn,
      },
    ),
  );

  // Two map calls (one per chunk) plus one reduce/merge call.
  assert.strictEqual(calls, 3);
  assert.strictEqual(result.length, 1);
  assert.match(result[0], /^summary of:/);
});

test("summarizeText dispatches to the YouTube pipeline when type is 'youtube', still honoring mode", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "brief";
  }

  const result = await collect(
    summarizeText(
      {
        text: "[0:00] hello world",
        title: "A Video",
        url: "https://youtube.com/watch?v=abc",
        mode: "sentences",
        type: "youtube",
      },
      {
        chunkTextFn: () => ["[0:00] hello world"],
        chatStreamFn,
      },
    ),
  );

  assert.deepStrictEqual(result, ["brief"]);
  // Should hit the YouTube assembly prompt (mentions the video title/URL
  // and timestamp-link rules), carrying the requested sentences style
  // rather than always falling back to the bullets style.
  assert.match(prompts[0], /A Video/);
  assert.match(prompts[0], /youtube\.com\/watch\?v=abc/);
  assert.match(prompts[0], /Output exactly 10-15 concise sentences/);
});
