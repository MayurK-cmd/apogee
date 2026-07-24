import test from "node:test";
import assert from "node:assert";

import { buildScaledBulletsStyle } from "../lib/prompts.js";

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
