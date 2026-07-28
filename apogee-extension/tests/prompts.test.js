import test from "node:test";
import assert from "node:assert";

import {
  buildScaledBulletsStyle,
  buildLanguageSystemPrompt,
  buildTranslatePrompt,
  resolveLanguageName,
} from "../lib/prompts.js";

test("buildScaledBulletsStyle matches the base 8-14 range for a single chunk", () => {
  assert.match(buildScaledBulletsStyle(1), /Output 8-14 concise bullet points/);
});

test("buildScaledBulletsStyle grows the target range with chunk count", () => {
  assert.match(
    buildScaledBulletsStyle(2),
    /Output 12-18 concise bullet points/,
  );
  assert.match(
    buildScaledBulletsStyle(3),
    /Output 16-22 concise bullet points/,
  );
});

test("buildScaledBulletsStyle plateaus at the max bullet count for long documents instead of growing unbounded", () => {
  const atPlateau = buildScaledBulletsStyle(5);
  const wellPastPlateau = buildScaledBulletsStyle(12);
  assert.match(atPlateau, /Output 24-30 concise bullet points/);
  assert.match(wellPastPlateau, /Output 24-30 concise bullet points/);
});

test("resolveLanguageName maps codes to display names, null for auto/unknown", () => {
  assert.strictEqual(resolveLanguageName("auto"), null);
  assert.strictEqual(resolveLanguageName(undefined), null);
  assert.strictEqual(resolveLanguageName("not-a-code"), null);
  assert.strictEqual(resolveLanguageName("es"), "Spanish");
  // Chinese variants resolve to their distinct display names.
  assert.strictEqual(resolveLanguageName("zh"), "Simplified Chinese");
  assert.strictEqual(resolveLanguageName("zh-hant"), "Traditional Chinese");
});

test("buildLanguageSystemPrompt is null for auto/unknown, a forceful directive otherwise", () => {
  assert.strictEqual(buildLanguageSystemPrompt("auto"), null);
  assert.strictEqual(buildLanguageSystemPrompt("xx"), null);
  const fr = buildLanguageSystemPrompt("fr");
  assert.match(fr, /French/);
  assert.match(fr, /ENTIRE response in French/);
});

test("buildTranslatePrompt targets the language and preserves links/timestamps", () => {
  const p = buildTranslatePrompt("[4:12](http://x) hola", "de");
  assert.match(p, /Translate the text below into German/);
  assert.match(p, /NEVER change the URL/);
  assert.match(p, /timestamps/);
  assert.match(p, /\[4:12\]\(http:\/\/x\) hola/);
});
