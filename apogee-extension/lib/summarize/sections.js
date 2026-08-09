import { chunkText, MAX_CHUNK_CHARS } from "./chunk.js";

const NUMBERING = /^\d{1,2}(?:\.\d{1,2}){0,3}\.?\s+/;

const SECTION_KEYWORD =
  /^(?:abstract|introduction|background|related work|prior work|motivation|methodolog(?:y|ies)|methods?|materials and methods|approach|experimental setup|experiments?|implementation|results?|evaluation|findings|analysis|discussion|limitations?|future work|conclusions?|concluding remarks|summary|references|bibliography|acknowledge?ments?|appendix|appendices)\b/i;

const TITLE_STOPWORDS = new Set([
  "and",
  "or",
  "of",
  "the",
  "for",
  "to",
  "in",
  "on",
  "a",
  "an",
  "with",
  "vs",
]);

function isTitleCased(s) {
  return s.split(/\s+/).every((word, i) => {
    const bare = word.replace(/[^A-Za-z]/g, "");
    if (!bare) return true;
    if (i > 0 && TITLE_STOPWORDS.has(bare.toLowerCase())) return true;
    return /^[A-Z]/.test(bare) || bare === bare.toUpperCase();
  });
}

function isHeadingLine(line) {
  const s = line.trim();
  if (!s) return false;

  if (/^#{1,6}\s+\S/.test(s)) return true;

  if (s.length > 90) return false;
  if (s.split(/\s+/).length > 12) return false;

  const rest = s.replace(NUMBERING, "").trim();
  if (!rest) return false;

  const kw = rest.match(SECTION_KEYWORD);
  if (kw) {
    const after = rest
      .slice(kw[0].length)
      .replace(/[\s:.]+$/, "")
      .trim();
    if (after === "") return true;
    return (
      !/[.?!,;]$/.test(rest) &&
      rest.split(/\s+/).length <= 6 &&
      isTitleCased(rest)
    );
  }

  const hadNumber = NUMBERING.test(s);

  if (hadNumber && /^[A-Z(]/.test(rest) && !/[.?!,;]$/.test(rest)) {
    return true;
  }

  if (
    rest.length >= 3 &&
    rest === rest.toUpperCase() &&
    /[A-Z]/.test(rest) &&
    /^[A-Z0-9][A-Z0-9 .:&/'-]*$/.test(rest) &&
    !/[.?!,;]$/.test(rest)
  ) {
    return true;
  }

  return false;
}

export function splitIntoSections(text) {
  const lines = (text || "").split("\n");
  const sections = [];
  let current = { heading: null, lines: [] };
  let headingCount = 0;

  const commit = () => {
    if (current.heading !== null || current.lines.some((l) => l.trim())) {
      sections.push(current);
    }
  };

  for (const line of lines) {
    if (isHeadingLine(line)) {
      commit();
      current = { heading: line.trim().replace(/^#{1,6}\s+/, ""), lines: [] };
      headingCount++;
    } else {
      current.lines.push(line);
    }
  }
  commit();

  if (headingCount === 0) return null;

  return sections.map((s) => ({
    heading: s.heading,
    text: s.lines.join("\n").trim(),
  }));
}

export function chunkBySections(text, maxChars = MAX_CHUNK_CHARS) {
  const limit = maxChars || MAX_CHUNK_CHARS;
  const sections = splitIntoSections(text);
  if (!sections) return chunkText(text, limit);

  const chunks = [];
  let buffer = "";

  const flush = () => {
    const t = buffer.trim();
    if (t) chunks.push(t);
    buffer = "";
  };

  for (const section of sections) {
    const block = section.heading
      ? `${section.heading}\n${section.text}`.trim()
      : section.text;
    if (!block) continue;

    if (block.length > limit) {
      flush();
      for (const piece of chunkText(block, limit)) chunks.push(piece);
      continue;
    }

    if (buffer && buffer.length + 2 + block.length > limit) flush();
    buffer = buffer ? `${buffer}\n\n${block}` : block;
  }
  flush();

  return chunks;
}
