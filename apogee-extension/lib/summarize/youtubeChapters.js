import { timestampToSeconds } from "./timestamps.js";

const CHAPTER_BLOCK = /^Chapters:\n((?:- \[\d{1,2}(?::\d{2}){1,2}\] .+\n?)+)/m;

const CHAPTER_ITEM = /^- \[(\d{1,2}(?::\d{2}){1,2})\]\s+(.+)$/;

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

export function stripChaptersBlock(text) {
  return (text || "")
    .replace(CHAPTER_BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
