import test from "node:test";
import assert from "node:assert";
import {
  parseChaptersBlock,
  stripChaptersBlock,
} from "../../lib/summarize/youtubeChapters.js";
import { buildYoutubeBriefPrompt } from "../../lib/summarize/prompts.js";

const CONTENT = [
  "Video Title:",
  "My Talk",
  "",
  "Chapters:",
  "- [0:00] Intro",
  "- [3:12] The main idea",
  "- [1:02:03] Wrap up",
  "",
  "Transcript:",
  "[0:00] hello [0:20] world [3:12] main [1:02:03] bye",
].join("\n");

test("parseChaptersBlock extracts chapters with second offsets", () => {
  assert.deepStrictEqual(parseChaptersBlock(CONTENT), [
    { start: 0, title: "Intro" },
    { start: 192, title: "The main idea" },
    { start: 3723, title: "Wrap up" },
  ]);
});

test("parseChaptersBlock returns [] when there is no Chapters block", () => {
  assert.deepStrictEqual(
    parseChaptersBlock("Video Title:\nX\n\nTranscript:\n[0:00] hi"),
    [],
  );
});

test("parseChaptersBlock ignores inline transcript timestamp markers", () => {
  const chapters = parseChaptersBlock(CONTENT);
  assert.ok(!chapters.some((c) => c.start === 20));
});

test("stripChaptersBlock removes the block but keeps the transcript", () => {
  const stripped = stripChaptersBlock(CONTENT);
  assert.ok(!/Chapters:/.test(stripped));
  assert.ok(!/- \[3:12\] The main idea/.test(stripped));
  assert.match(stripped, /Transcript:/);
  assert.match(stripped, /\[0:20\] world/);
});

test("buildYoutubeBriefPrompt builds deterministic per-chapter headings and links", () => {
  const out = buildYoutubeBriefPrompt(
    "My Talk",
    "https://youtube.com/watch?v=abc",
    "- [0:05] a point",
    [
      { start: 0, title: "Intro" },
      { start: 30, title: "Body" },
    ],
    60,
  );
  assert.match(out, /## Overview/);
  assert.match(out, /\*\*Key Takeaways\*\*/);
  assert.match(
    out,
    /### \[0:00\]\(https:\/\/www\.youtube\.com\/watch\?v=abc&t=0s\) Intro {3}\(covers 0s-30s\)/,
  );
  assert.match(
    out,
    /### \[0:30\]\(https:\/\/www\.youtube\.com\/watch\?v=abc&t=30s\) Body {3}\(covers 30s-60s\)/,
  );
});
