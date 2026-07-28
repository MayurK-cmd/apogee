import test from "node:test";
import assert from "node:assert";

import {
  resolveOpusModel,
  splitTranslatablePrefix,
  translatePreservingStructure,
} from "../lib/opusTranslate.js";

test("resolveOpusModel picks direct en->X pairs where they exist", () => {
  assert.deepStrictEqual(resolveOpusModel("en", "es"), {
    model: "Xenova/opus-mt-en-es",
    token: "",
  });
  assert.deepStrictEqual(resolveOpusModel("en", "zh"), {
    model: "Xenova/opus-mt-en-zh",
    token: "",
  });
  // Japanese uses the "jap" model spelling.
  assert.deepStrictEqual(resolveOpusModel("en", "ja"), {
    model: "Xenova/opus-mt-en-jap",
    token: "",
  });
});

test("resolveOpusModel uses the grouped en-mul model (with token) for gap languages", () => {
  // Estonian has no direct en-et model, but en-mul covers it via >>est<<.
  assert.deepStrictEqual(resolveOpusModel("en", "et"), {
    model: "Xenova/opus-mt-en-mul",
    token: ">>est<< ",
  });
  assert.deepStrictEqual(resolveOpusModel("en", "lv"), {
    model: "Xenova/opus-mt-en-mul",
    token: ">>lav<< ",
  });
});

test("resolveOpusModel returns null for uncovered languages (LLM fallback)", () => {
  assert.strictEqual(resolveOpusModel("en", "sk"), null); // Slovak
  assert.strictEqual(resolveOpusModel("en", "ko"), null); // Korean
  assert.strictEqual(resolveOpusModel("en", "zh-hant"), null); // Traditional Chinese
});

test("resolveOpusModel handles X->en (direct or mul-en catch-all) and no-op/foreign-pivot", () => {
  assert.deepStrictEqual(resolveOpusModel("es", "en"), {
    model: "Xenova/opus-mt-es-en",
    token: "",
  });
  // A source with no direct X-en model still routes through mul-en.
  assert.deepStrictEqual(resolveOpusModel("sl", "en"), {
    model: "Xenova/opus-mt-mul-en",
    token: "",
  });
  assert.strictEqual(resolveOpusModel("es", "es"), null); // same lang
  assert.strictEqual(resolveOpusModel("es", "de"), null); // foreign<->foreign
});

test("splitTranslatablePrefix peels off bullets and timestamp-link prefixes", () => {
  assert.deepStrictEqual(splitTranslatablePrefix("- Hello world"), {
    prefix: "- ",
    rest: "Hello world",
  });
  assert.deepStrictEqual(
    splitTranslatablePrefix("[4:12](https://y.tube?t=252s): the point"),
    { prefix: "[4:12](https://y.tube?t=252s): ", rest: "the point" },
  );
  assert.deepStrictEqual(splitTranslatablePrefix("plain line"), {
    prefix: "",
    rest: "plain line",
  });
});

test("translatePreservingStructure keeps prefixes/blank lines and only translates prose", async () => {
  // stand-in batched translateFn: array in, array out, in order.
  const upper = async (lines) => lines.map((s) => s.toUpperCase());
  const input = "- one\n\n[4:12](u): two";
  const out = await translatePreservingStructure(input, upper);
  assert.strictEqual(out, "- ONE\n\n[4:12](u): TWO");
});

test("translatePreservingStructure batches lines and reports progress per batch", async () => {
  const calls = [];
  const progress = [];
  const batch = async (lines) => {
    calls.push(lines);
    return lines.map((s) => s.toUpperCase());
  };
  const input = "- a\n- b\n- c\n- d\n- e"; // 5 translatable lines
  const out = await translatePreservingStructure(input, batch, {
    batchSize: 2,
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.strictEqual(out, "- A\n- B\n- C\n- D\n- E");
  // 5 lines at batchSize 2 -> batches of [2, 2, 1].
  assert.deepStrictEqual(
    calls.map((c) => c.length),
    [2, 2, 1],
  );
  assert.deepStrictEqual(progress, [
    [2, 5],
    [4, 5],
    [5, 5],
  ]);
});
