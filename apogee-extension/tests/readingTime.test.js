import test from "node:test";
import assert from "node:assert";
import { formatTimeSaved, formatVideoTimeSaved } from "../lib/readingTime.js";

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
  // 20 min video, a summary that reads in ~1 min (225 words @ 225 wpm).
  const result = formatVideoTimeSaved(20 * 60, words(225));
  assert.strictEqual(result, "~19 min saved");
});

test("formatVideoTimeSaved reports seconds when the gap is under a minute", () => {
  // 48s video vs. a summary that reads in ~12s (45 words @ 225 wpm): a 36s
  // gap, comfortably between the 30s "barely any gap" floor and the 60s
  // seconds/minutes formatting boundary.
  const result = formatVideoTimeSaved(48, words(45));
  assert.match(result, /^~\d+s saved$/);
});

test("formatVideoTimeSaved returns null when there's barely any gap", () => {
  assert.strictEqual(formatVideoTimeSaved(60, words(200)), null);
});

test("formatVideoTimeSaved returns null when the summary takes longer to read than the video runs", () => {
  // 30s video, a summary that itself takes ~1 min to read (225 words).
  assert.strictEqual(formatVideoTimeSaved(30, words(225)), null);
});

test("formatVideoTimeSaved returns null for a zero/missing duration", () => {
  assert.strictEqual(formatVideoTimeSaved(0, ""), null);
  assert.strictEqual(formatVideoTimeSaved(undefined, ""), null);
});
