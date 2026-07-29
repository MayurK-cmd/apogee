import test from "node:test";
import assert from "node:assert";

import {
  streamInTargetLanguage,
  generateInTargetLanguage,
} from "../../lib/language/languageOutput.js";

// A chatFn(prompt, { system }) that records each call and returns scripted
// output, so we can assert on pass count, system usage, and translate routing.
function makeChat(outputs) {
  const calls = [];
  const fn = async function* (prompt, opts = {}) {
    const isTranslate = prompt.startsWith("You are a translation engine");
    calls.push({ system: opts.system || null, isTranslate, prompt });
    yield outputs[calls.length - 1] ?? "out";
  };
  return { fn, calls };
}

async function collect(gen) {
  let out = "";
  for await (const t of gen) out += t;
  return out;
}

test("auto/unknown language streams straight through: no system, no detect, no translate", async () => {
  const { fn, calls } = makeChat(["plain output"]);
  let detectCalled = false;
  const out = await collect(
    streamInTargetLanguage(fn, "PROMPT", "auto", {
      detectLanguageFn: async () => {
        detectCalled = true;
        return "en";
      },
    }),
  );
  assert.strictEqual(out, "plain output");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].system, null);
  assert.strictEqual(detectCalled, false);
});

test("compliant first pass: one pass with a system directive, emitted as-is", async () => {
  const { fn, calls } = makeChat(["Respuesta en español"]);
  let onFallback = false;
  const out = await collect(
    streamInTargetLanguage(fn, "PROMPT", "es", {
      detectLanguageFn: async () => "es",
      onFallback: () => {
        onFallback = true;
      },
    }),
  );
  assert.strictEqual(out, "Respuesta en español");
  assert.strictEqual(calls.length, 1);
  assert.ok(/Spanish/.test(calls[0].system));
  assert.strictEqual(calls[0].isTranslate, false);
  assert.strictEqual(onFallback, false);
});

test("slipped first pass: falls back to a translate pass and fires onFallback", async () => {
  const { fn, calls } = makeChat([
    "English answer (slip)",
    "Respuesta traducida",
  ]);
  let onFallback = false;
  const out = await collect(
    streamInTargetLanguage(fn, "PROMPT", "es", {
      detectLanguageFn: async () => "en",
      onFallback: () => {
        onFallback = true;
      },
    }),
  );
  assert.strictEqual(out, "Respuesta traducida");
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].isTranslate, true);
  assert.strictEqual(onFallback, true);
});

test("translateFn (opus mode): generates neutrally then uses the MT function, no system directive", async () => {
  const { fn, calls } = makeChat(["English summary"]);
  const out = await collect(
    streamInTargetLanguage(fn, "PROMPT", "es", {
      translateFn: async (text, lang) => `[${lang}] ${text}`,
    }),
  );
  assert.strictEqual(out, "[es] English summary");
  assert.strictEqual(calls.length, 1, "one neutral generation pass");
  assert.strictEqual(calls[0].system, null, "no system directive in opus mode");
});

test("translateFn returning null falls back to the LLM translate pass", async () => {
  const { fn, calls } = makeChat(["English summary", "traducción LLM"]);
  const out = await collect(
    streamInTargetLanguage(fn, "PROMPT", "es", {
      translateFn: async () => null, // MT can't cover this language
    }),
  );
  assert.strictEqual(out, "traducción LLM");
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].isTranslate, true, "LLM translate fallback ran");
});

test("generateInTargetLanguage buffers the stream into a single string", async () => {
  const { fn } = makeChat(["dos preguntas"]);
  const out = await generateInTargetLanguage(fn, "PROMPT", "es", {
    detectLanguageFn: async () => "es",
  });
  assert.strictEqual(out, "dos preguntas");
});
