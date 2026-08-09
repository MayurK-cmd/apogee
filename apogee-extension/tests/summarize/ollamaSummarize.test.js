import test from "node:test";
import assert from "node:assert";

import {
  summarizeText,
  discussionPostExcerpt,
} from "../../lib/summarize/ollamaSummarize.js";

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

  assert.deepStrictEqual(result, []);
  assert.strictEqual(
    calls,
    1,
    "should not call the model for chunk two, or run the reduce merge, after abort",
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

  assert.strictEqual(calls, 3);
  assert.strictEqual(result.length, 1);
  assert.match(result[0], /^summary of:/);
});

test("summarizeText (bullets) also runs every chunk plus a final reduce/synthesis merge, not a flat per-chunk concatenation", async () => {
  let calls = 0;
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    calls += 1;
    prompts.push(prompt);
    yield calls <= 2 ? `- bullet from chunk ${calls}\n` : "- merged bullet\n";
  }

  const result = await collect(
    summarizeText(
      { text: "irrelevant", mode: "bullets" },
      {
        chunkTextFn: () => ["chunk one", "chunk two"],
        chatStreamFn,
      },
    ),
  );

  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(result, ["- merged bullet\n"]);
  assert.match(prompts[2], /bullet from chunk 1/);
  assert.match(prompts[2], /bullet from chunk 2/);
  assert.match(prompts[2], /Output 7-10 bullet points/);
});

test("summarizeText (multi-chunk article) uses extract-then-abstract: extract notes per chunk, synthesize the reduce", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "- extracted point\n";
  }

  await collect(
    summarizeText(
      { text: "long article", title: "T", url: "u", mode: "bullets" },
      { chunkTextFn: () => ["part A", "part B"], chatStreamFn },
    ),
  );

  assert.match(prompts[0], /extracting the key information/i);
  assert.match(prompts[0], /PART 1 OF 2/);
  assert.match(prompts[1], /PART 2 OF 2/);
  assert.match(prompts[2], /notes extracted from across a long document/i);
  assert.match(prompts[2], /EXTRACTED NOTES/);
});

test("summarizeText dispatches to the YouTube pipeline when type is 'youtube', using the fixed brief + key-moments format", async () => {
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
  assert.match(prompts[0], /A Video/);
  assert.match(prompts[0], /youtube\.com\/watch\?v=abc/);
  assert.match(prompts[0], /## Key moments/);
  assert.match(prompts[0], /key moments, matching this video's length/);
  assert.doesNotMatch(prompts[0], /Output exactly 10-15 concise sentences/);
});

test("summarizeText dispatches to the video pipeline for type 'bilibili', with Bilibili-style jump links", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "brief";
  }

  const result = await collect(
    summarizeText(
      {
        text: "[0:00] ni hao",
        title: "A Bilibili Video",
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        mode: "bullets",
        type: "bilibili",
      },
      {
        chunkTextFn: () => ["[0:00] ni hao"],
        chatStreamFn,
      },
    ),
  );

  assert.deepStrictEqual(result, ["brief"]);
  assert.match(prompts[0], /A Bilibili Video/);
  assert.match(prompts[0], /BV1xx411c7mD\?t=SECONDS[^s]/);
});

test("summarizeText appends custom instructions to the final summary prompt only, not the per-chunk map passes", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "x";
  }

  await collect(
    summarizeText(
      {
        text: "part A part B",
        title: "Doc",
        url: "https://example.com",
        mode: "bullets",
        customInstructions: "Answer in a formal tone.",
      },
      { chunkTextFn: () => ["part A", "part B"], chatStreamFn },
    ),
  );

  const mapPrompts = prompts.slice(0, -1);
  const reducePrompt = prompts[prompts.length - 1];
  for (const p of mapPrompts) {
    assert.doesNotMatch(p, /ADDITIONAL INSTRUCTIONS FROM THE USER/);
  }
  assert.match(reducePrompt, /ADDITIONAL INSTRUCTIONS FROM THE USER/);
  assert.match(reducePrompt, /Answer in a formal tone\./);
});

test("discussionPostExcerpt pulls the Post body out of extracted discussion content, empty for link posts", () => {
  const withPost =
    "Reddit discussion\n\nTitle: Foo\nr/bar\n\nPost:\nThis is the self text body.\n\nComments (path [n.n] shows the reply tree):\n[1] a: hi";
  assert.strictEqual(
    discussionPostExcerpt(withPost),
    "This is the self text body.",
  );

  const linkPost =
    "Reddit discussion\n\nTitle: Foo\nr/bar\nLinks to: https://x.com\n\nComments (path [n.n] shows the reply tree):\n[1] a: hi";
  assert.strictEqual(discussionPostExcerpt(linkPost), "");
});

test("summarizeText (reddit) prepends the post as context to later chunks but not the first", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "note";
  }

  await collect(
    summarizeText(
      {
        text: "Reddit discussion\n\nTitle: T\n\nPost:\nOriginal poster's story.\n\nComments (path [n.n] shows the reply tree):\n[1] a: hi",
        title: "T",
        url: "https://reddit.com/r/x/comments/1/",
        mode: "bullets",
        type: "reddit",
      },
      {
        chunkTextFn: () => ["comments chunk A", "comments chunk B"],
        chatStreamFn,
      },
    ),
  );

  assert.doesNotMatch(prompts[0], /Post context/);
  assert.match(prompts[1], /\[Post context\]/);
  assert.match(prompts[1], /Original poster's story\./);
});

function makeRecordingChat(outputs) {
  const calls = [];
  async function* fn(_host, _model, prompt, opts) {
    const isTranslate = prompt.startsWith("You are a translation engine");
    calls.push({ system: opts?.system || null, isTranslate });
    yield outputs[calls.length - 1] ?? "out";
  }
  return { fn, calls };
}

test("summarizeText target language: compliant first pass emits in ONE pass with a system directive, no translate", async () => {
  const { fn, calls } = makeRecordingChat(["Resumen en español"]);
  let out = "";
  for await (const t of summarizeText(
    {
      text: "English article.",
      title: "T",
      url: "u",
      mode: "bullets",
      model: "m",
      language: "es",
    },
    {
      chatStreamFn: fn,
      chunkTextFn: (x) => [x],
      detectLanguageFn: async () => "es",
    },
  )) {
    out += t;
  }
  assert.strictEqual(calls.length, 1, "only one model pass");
  assert.ok(
    calls[0].system && /Spanish/.test(calls[0].system),
    "first pass carries a Spanish system directive",
  );
  assert.strictEqual(calls[0].isTranslate, false);
  assert.strictEqual(out, "Resumen en español");
});

test("summarizeText target language: slipped first pass triggers a translate fallback pass", async () => {
  const { fn, calls } = makeRecordingChat([
    "English summary (slipped)",
    "Resumen traducido",
  ]);
  let out = "";
  for await (const t of summarizeText(
    {
      text: "English article.",
      title: "T",
      url: "u",
      mode: "bullets",
      model: "m",
      language: "es",
    },
    {
      chatStreamFn: fn,
      chunkTextFn: (x) => [x],
      detectLanguageFn: async () => "en",
    },
  )) {
    out += t;
  }
  assert.strictEqual(calls.length, 2, "summary pass + translate fallback");
  assert.strictEqual(
    calls[1].isTranslate,
    true,
    "second pass is the translate prompt",
  );
  assert.strictEqual(out, "Resumen traducido");
});

test("summarizeText with no/auto language streams directly with no system directive and no verify", async () => {
  const { fn, calls } = makeRecordingChat(["Plain summary"]);
  let detectCalled = false;
  let out = "";
  for await (const t of summarizeText(
    {
      text: "Article.",
      title: "T",
      url: "u",
      mode: "bullets",
      model: "m",
      language: "auto",
    },
    {
      chatStreamFn: fn,
      chunkTextFn: (x) => [x],
      detectLanguageFn: async () => {
        detectCalled = true;
        return "en";
      },
    },
  )) {
    out += t;
  }
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].system,
    null,
    "no system directive when language is auto",
  );
  assert.strictEqual(
    detectCalled,
    false,
    "no language verification when language is auto",
  );
  assert.strictEqual(out, "Plain summary");
});
