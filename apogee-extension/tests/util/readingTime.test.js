import test from "node:test";
import assert from "node:assert";
import {
  formatTimeSaved,
  formatVideoTimeSaved,
  formatTimeSavedFromWordCount,
  timeSavedInputsFor,
  formatTimeSavedFromInputs,
} from "../../lib/util/readingTime.js";

function words(n) {
  return Array(n).fill("word").join(" ");
}

test("formatTimeSaved reports whole minutes for a long article vs a short summary", () => {
  const result = formatTimeSaved(words(2250), words(50));
  assert.strictEqual(result, "~10 min saved");
});

test("formatTimeSaved reports seconds when the gap is under a minute", () => {
  const result = formatTimeSaved(words(300), words(100));
  assert.match(result, /^~\d+s saved$/);
});

test("formatTimeSaved returns null when there's barely any gap", () => {
  assert.strictEqual(formatTimeSaved(words(10), words(9)), null);
});

test("formatTimeSaved returns null when the summary isn't shorter", () => {
  assert.strictEqual(formatTimeSaved(words(50), words(60)), null);
});

test("formatTimeSaved returns null for empty input", () => {
  assert.strictEqual(formatTimeSaved("", ""), null);
});

test("formatVideoTimeSaved reports whole minutes for a long video vs a short summary", () => {
  const result = formatVideoTimeSaved(20 * 60, words(225));
  assert.strictEqual(result, "~19 min saved");
});

test("formatVideoTimeSaved reports seconds when the gap is under a minute", () => {
  const result = formatVideoTimeSaved(48, words(45));
  assert.match(result, /^~\d+s saved$/);
});

test("formatVideoTimeSaved returns null when there's barely any gap", () => {
  assert.strictEqual(formatVideoTimeSaved(60, words(200)), null);
});

test("formatVideoTimeSaved returns null when the summary takes longer to read than the video runs", () => {
  assert.strictEqual(formatVideoTimeSaved(30, words(225)), null);
});

test("formatVideoTimeSaved returns null for a zero/missing duration", () => {
  assert.strictEqual(formatVideoTimeSaved(0, ""), null);
  assert.strictEqual(formatVideoTimeSaved(undefined, ""), null);
});

test("formatTimeSavedFromWordCount matches formatTimeSaved given the same original text", () => {
  assert.strictEqual(
    formatTimeSavedFromWordCount(2250, words(50)),
    formatTimeSaved(words(2250), words(50)),
  );
});

test("timeSavedInputsFor distills the minimal restore inputs per page type", () => {
  assert.deepStrictEqual(
    timeSavedInputsFor({ type: "youtube", durationSeconds: 1200 }),
    { kind: "video", durationSeconds: 1200 },
  );
  assert.deepStrictEqual(
    timeSavedInputsFor({ type: "bilibili", durationSeconds: 600 }),
    { kind: "video", durationSeconds: 600 },
  );
  assert.deepStrictEqual(
    timeSavedInputsFor({ type: "article", content: words(2250) }),
    { kind: "text", originalWords: 2250 },
  );
  assert.strictEqual(
    timeSavedInputsFor({ type: "article", content: "" }),
    null,
  );
  assert.strictEqual(timeSavedInputsFor(), null);
});

test("timeSavedInputsFor round-trips through formatTimeSavedFromInputs to the live badge value", () => {
  const videoInputs = timeSavedInputsFor({
    type: "youtube",
    durationSeconds: 1200,
  });
  assert.strictEqual(
    formatTimeSavedFromInputs(videoInputs, words(225)),
    formatVideoTimeSaved(1200, words(225)),
  );

  const articleInputs = timeSavedInputsFor({
    type: "article",
    content: words(2250),
  });
  assert.strictEqual(
    formatTimeSavedFromInputs(articleInputs, words(50)),
    formatTimeSaved(words(2250), words(50)),
  );

  assert.strictEqual(formatTimeSavedFromInputs(null, words(50)), null);
});
