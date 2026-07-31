import test from "node:test";
import assert from "node:assert";

import {
  buildScaledBulletsStyle,
  buildLanguageSystemPrompt,
  buildTranslatePrompt,
  buildDiscussionPrompt,
  buildYoutubeAssemblyPrompt,
  youtubeSummaryScale,
  withCustomInstructions,
  resolveLanguageName,
} from "../../lib/summarize/prompts.js";

test("youtubeSummaryScale grows key-moment and gist targets with video length", () => {
  const short = youtubeSummaryScale(3 * 60); // 3 min
  const medium = youtubeSummaryScale(23 * 60); // 23 min
  const long = youtubeSummaryScale(90 * 60); // 90 min

  // A short clip gets a small, floor-bounded target; a long talk many more.
  assert.ok(
    short.minMoments >= 3 && short.maxMoments <= 6,
    "short stays small",
  );
  assert.ok(
    medium.minMoments > short.maxMoments,
    "a 23-min video asks for more moments than a 3-min one",
  );
  assert.ok(
    medium.minMoments >= 15,
    "a 23-min video still comfortably clears 15 moments",
  );
  // Bounded so a multi-hour video doesn't produce an unusable wall.
  assert.ok(long.maxMoments <= 40, "capped for very long videos");
  assert.ok(long.summaryMax >= short.summaryMax, "gist grows with length too");
});

test("buildYoutubeAssemblyPrompt scales the moment count into the prompt text", () => {
  const shortPrompt = buildYoutubeAssemblyPrompt(
    "T",
    "https://www.youtube.com/watch?v=abc12345678",
    "[0:30] a point",
    3 * 60,
  );
  const longPrompt = buildYoutubeAssemblyPrompt(
    "T",
    "https://www.youtube.com/watch?v=abc12345678",
    "[0:30] a point",
    90 * 60,
  );
  const { minMoments: sMin } = youtubeSummaryScale(3 * 60);
  const { minMoments: lMin } = youtubeSummaryScale(90 * 60);
  assert.match(shortPrompt, new RegExp(`roughly ${sMin}-`));
  assert.match(longPrompt, new RegExp(`roughly ${lMin}-`));
  assert.match(shortPrompt, /This video is about 3 minutes long/);
  assert.match(longPrompt, /This video is about 90 minutes long/);
});

test("buildScaledBulletsStyle matches the base 5-8 range for a single chunk", () => {
  assert.match(buildScaledBulletsStyle(1), /Output 5-8 bullet points/);
});

test("bullets style asks for substantial multi-sentence bullets, not one-liners", () => {
  assert.match(buildScaledBulletsStyle(1), /2-3 full sentences/);
});

test("buildScaledBulletsStyle grows the target range with chunk count", () => {
  assert.match(buildScaledBulletsStyle(2), /Output 7-10 bullet points/);
  assert.match(buildScaledBulletsStyle(3), /Output 9-12 bullet points/);
});

test("buildScaledBulletsStyle plateaus at the max bullet count for long documents instead of growing unbounded", () => {
  const atPlateau = buildScaledBulletsStyle(5);
  const wellPastPlateau = buildScaledBulletsStyle(12);
  assert.match(atPlateau, /Output 11-14 bullet points/);
  assert.match(wellPastPlateau, /Output 11-14 bullet points/);
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

test("buildDiscussionPrompt frames a thread synthesis, explains path notation, and keeps the mandatory style", () => {
  const p = buildDiscussionPrompt(
    "Ask HN: X?",
    "https://news.ycombinator.com/item?id=1",
    "[1] <replies: 2> alice: point\n[1.1] {downvotes: 3} bob: reply",
    "bullets",
  );
  // Discussion-oriented framing, not the article summarizer.
  assert.match(p, /discussion thread/i);
  assert.match(p, /disagree/i);
  // Explains the extractor's path / replies / downvotes notation.
  assert.match(p, /path in the reply tree/i);
  assert.match(p, /downvotes/i);
  // Still carries the mandatory selected style and the thread body.
  assert.match(p, /5-8 bullet points/);
  assert.match(p, /The SUMMARY STYLE is mandatory/);
  assert.match(p, /\[1\.1\] \{downvotes: 3\} bob: reply/);
});

test("buildTranslatePrompt targets the language and preserves links/timestamps", () => {
  const p = buildTranslatePrompt("[4:12](http://x) hola", "de");
  assert.match(p, /Translate the text below into German/);
  assert.match(p, /NEVER change the URL/);
  assert.match(p, /timestamps/);
  assert.match(p, /\[4:12\]\(http:\/\/x\) hola/);
});

test("withCustomInstructions is a no-op for blank/whitespace input", () => {
  const base = "BASE PROMPT";
  assert.strictEqual(withCustomInstructions(base, ""), base);
  assert.strictEqual(withCustomInstructions(base, "   \n  "), base);
  assert.strictEqual(withCustomInstructions(base, undefined), base);
});

test("withCustomInstructions appends the user's text under a subordinate, injection-resistant header", () => {
  const p = withCustomInstructions("BASE PROMPT", "Explain like I'm five.");
  // Keeps the original prompt intact and adds the user's instructions after it.
  assert.match(p, /^BASE PROMPT/);
  assert.match(p, /ADDITIONAL INSTRUCTIONS FROM THE USER/);
  assert.match(p, /Explain like I'm five\./);
  // The header must keep the grounding rules dominant so a hostile page can't
  // smuggle instructions through this channel.
  assert.match(p, /grounding rules win/);
});

test("buildYoutubeAssemblyPrompt emits YouTube-style unit-bearing jump links", () => {
  const p = buildYoutubeAssemblyPrompt(
    "T",
    "https://www.youtube.com/watch?v=abc12345678",
    "[4:12] a point",
    600,
    "bullets",
  );
  // YouTube's time param carries the "s" unit: ...&t=252s
  assert.match(p, /watch\?v=abc12345678&t=SECONDSs/);
  assert.match(p, /watch\?v=abc12345678&t=252s/);
});

test("buildYoutubeAssemblyPrompt emits Bilibili-style bare-second jump links", () => {
  const p = buildYoutubeAssemblyPrompt(
    "T",
    "https://www.bilibili.com/video/BV1xx411c7mD",
    "[4:12] a point",
    600,
    "bullets",
  );
  // Bilibili's time param is a bare integer second count (no "s" unit): ...?t=252
  assert.match(p, /BV1xx411c7mD\?t=SECONDS[^s]/);
  assert.match(p, /BV1xx411c7mD\?t=252[^s]/);
  assert.doesNotMatch(p, /t=252s/);
});
