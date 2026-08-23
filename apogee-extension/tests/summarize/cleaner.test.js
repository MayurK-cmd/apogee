import test from "node:test";
import assert from "node:assert";
import { cleanText } from "../../lib/summarize/cleaner.js";

test("cleanText passes through already-clean text unchanged", () => {
  const input = "This is a clean summary sentence.";
  assert.strictEqual(cleanText(input), input);

  const multiline = "First paragraph.\n\nSecond paragraph.";
  assert.strictEqual(cleanText(multiline), multiline);
});

test("cleanText handles empty input and whitespace-only strings", () => {
  assert.strictEqual(cleanText(""), "");
  assert.strictEqual(cleanText("   \t   "), "");
  assert.strictEqual(cleanText("\n  \n\t  \n"), "");
});

test("cleanText collapses multiple inline spaces and tabs", () => {
  const input = "This   has    extra \t  spaces.";
  assert.strictEqual(cleanText(input), "This has extra spaces.");
});

test("cleanText trims whitespace per line", () => {
  const input = "  Line one  \n  Line two  ";
  assert.strictEqual(cleanText(input), "Line one\nLine two");
});

test("cleanText collapses excessive newlines down to double newlines", () => {
  const input = "Header\n\n\n\nBody paragraph 1\n\n\nBody paragraph 2";
  assert.strictEqual(
    cleanText(input),
    "Header\n\nBody paragraph 1\n\nBody paragraph 2",
  );
});

test("cleanText trims overall leading and trailing whitespace", () => {
  const input = "\n\n  \n  Clean text here.  \n\n  ";
  assert.strictEqual(cleanText(input), "Clean text here.");
});
