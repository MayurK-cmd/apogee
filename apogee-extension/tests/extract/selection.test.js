import test from "node:test";
import assert from "node:assert";
import {
  MIN_SELECTION_LENGTH,
  normalizeSelectedText,
  isSummarizableSelection,
} from "../../lib/extract/selection.js";

test("selection extraction normalization collapses whitespace", () => {
  assert.strictEqual(
    normalizeSelectedText("  one\n two\t three  "),
    "one two three",
  );
});

test("empty and short selections are not summarizable", () => {
  assert.strictEqual(isSummarizableSelection(""), false);
  assert.strictEqual(
    isSummarizableSelection("x".repeat(MIN_SELECTION_LENGTH - 1)),
    false,
  );
  assert.strictEqual(
    isSummarizableSelection("x".repeat(MIN_SELECTION_LENGTH)),
    true,
  );
});
