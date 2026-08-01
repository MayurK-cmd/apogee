// Parses (and strips) the "Chapters:" block that the YouTube extractor
// (content/extractors/youtube.js) embeds in a video's extracted content when
// the creator's description defines chapter markers. The block is a header
// line "Chapters:" followed by one "- [MM:SS] Title" line per chapter (a
// leading [H:MM:SS] past the hour). lib/youtubeSummarize.js turns the parsed
// chapters into an OpenBrief-style chaptered brief, and strips the block from
// the transcript text before the map/assembly passes so it isn't re-summarized
// as though it were transcript content.
//
// The extractor can't import this module, content scripts are plain,
// non-ESM scripts injected via chrome.scripting, so it mirrors this emit
// format inline; keep the two in sync.

import { timestampToSeconds } from "./timestamps.js";

// The "Chapters:" header plus its run of consecutive "- [ts] title" lines.
const CHAPTER_BLOCK = /^Chapters:\n((?:- \[\d{1,2}(?::\d{2}){1,2}\] .+\n?)+)/m;

// A single "- [MM:SS] Title" / "- [H:MM:SS] Title" item within that block.
const CHAPTER_ITEM = /^- \[(\d{1,2}(?::\d{2}){1,2})\]\s+(.+)$/;

/**
 * Extracts `[{ start, title }]` from the "Chapters:" block in `text`, or `[]`
 * when there is none. `start` is in seconds.
 */
export function parseChaptersBlock(text) {
  const block = (text || "").match(CHAPTER_BLOCK);
  if (!block) return [];
  const chapters = [];
  for (const line of block[1].split("\n")) {
    const item = line.match(CHAPTER_ITEM);
    if (item) {
      chapters.push({
        start: timestampToSeconds(item[1]),
        title: item[2].trim(),
      });
    }
  }
  return chapters;
}

/** Removes the "Chapters:" block from `text`, tidying the seam it leaves. */
export function stripChaptersBlock(text) {
  return (text || "")
    .replace(CHAPTER_BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
