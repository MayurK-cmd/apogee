import test from "node:test";
import assert from "node:assert";

import { resolveEffectiveLanguage } from "../../lib/language/detectLanguage.js";

// Stub chrome.i18n.detectLanguage with a fixed top language/percentage.
function stubDetect(language, percentage = 90) {
  globalThis.chrome = {
    i18n: {
      detectLanguage: async () => ({
        languages: language ? [{ language, percentage }] : [],
      }),
    },
  };
}

function clearDetect() {
  delete globalThis.chrome;
}

test("auto/unknown target never translates (and skips detection)", async () => {
  clearDetect(); // detection unavailable on purpose
  assert.strictEqual(
    await resolveEffectiveLanguage("hola mundo", "auto"),
    "auto",
  );
  assert.strictEqual(
    await resolveEffectiveLanguage("hola mundo", "xx"),
    "auto",
  );
});

test("English source + English target skips the identity translate pass", async () => {
  stubDetect("en");
  assert.strictEqual(
    await resolveEffectiveLanguage("This is an English article.", "en"),
    "auto",
  );
});

test("English source + Spanish target translates", async () => {
  stubDetect("en");
  assert.strictEqual(
    await resolveEffectiveLanguage("This is an English article.", "es"),
    "es",
  );
});

test("Spanish source + English target translates", async () => {
  stubDetect("es");
  assert.strictEqual(
    await resolveEffectiveLanguage("Esto es un artículo en español.", "en"),
    "en",
  );
});

test("region subtags compare by base code (en-US matches en)", async () => {
  stubDetect("en-US");
  assert.strictEqual(await resolveEffectiveLanguage("text", "en"), "auto");
});

test("unsure/unavailable detection errs toward translating for correctness", async () => {
  stubDetect("en", 20); // below confidence threshold -> treated as unknown
  assert.strictEqual(await resolveEffectiveLanguage("text", "es"), "es");
  clearDetect();
  assert.strictEqual(await resolveEffectiveLanguage("text", "es"), "es");
});

test.after(() => clearDetect());
