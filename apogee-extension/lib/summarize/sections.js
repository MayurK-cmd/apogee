// Heading-aware document segmentation, used by lib/ollamaSummarize.js to chunk
// long documents on their own section boundaries instead of the blind
// character slices lib/chunk.js produces. Keeping a chunk from straddling,
// say, half of a paper's Methods section and half of its Results makes each
// map-phase summary coherent about a single topic, which the reduce pass then
// merges cleanly. This is the local, privacy-preserving equivalent of the
// structure-awareness a cloud service like asXiv gets "for free" by handing a
// whole PDF to a large model: we detect the structure ourselves rather than
// shipping the document anywhere.
//
// Whenever a document has no detectable structure (most short pages), both
// functions fall back to the plain character chunker, so unstructured content
// behaves exactly as it did before.

import { chunkText, MAX_CHUNK_CHARS } from "./chunk.js";

// A leading section number: "1 ", "2.3 ", "4. " (up to a few dotted levels).
// Requires trailing whitespace so an inline decimal like "3.5x faster" or a
// bracketed reference marker isn't mistaken for numbering.
const NUMBERING = /^\d{1,2}(?:\.\d{1,2}){0,3}\.?\s+/;

// Well-known section names (matched against the de-numbered line start), the
// backbone of the detector. Covers scientific-paper structure plus the
// generic article headings these functions also run over.
const SECTION_KEYWORD =
  /^(?:abstract|introduction|background|related work|prior work|motivation|methodolog(?:y|ies)|methods?|materials and methods|approach|experimental setup|experiments?|implementation|results?|evaluation|findings|analysis|discussion|limitations?|future work|conclusions?|concluding remarks|summary|references|bibliography|acknowledge?ments?|appendix|appendices)\b/i;

// Small connective words allowed lowercase inside an otherwise title-cased
// heading ("Results and Discussion", "Materials and Methods").
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

// A short phrase where every significant word is capitalized (or ALL CAPS),
// as headings are, the signal that separates "Related Work" (a heading) from
// "Prior work was limited." (a sentence that merely opens with a keyword).
function isTitleCased(s) {
  return s.split(/\s+/).every((word, i) => {
    const bare = word.replace(/[^A-Za-z]/g, "");
    if (!bare) return true;
    if (i > 0 && TITLE_STOPWORDS.has(bare.toLowerCase())) return true;
    return /^[A-Z]/.test(bare) || bare === bare.toUpperCase();
  });
}

// Decides whether a single line is a section heading. Deliberately
// conservative: a false negative just leaves a section merged with its
// neighbor (no worse than today's blind chunking), while a false positive
// fragments the text, so each rule below excludes anything that reads like a
// running sentence.
function isHeadingLine(line) {
  const s = line.trim();
  if (!s) return false;

  // Markdown ATX heading, as an innerText-style extraction can surface.
  if (/^#{1,6}\s+\S/.test(s)) return true;

  // Headings are short. Bail early on anything sentence- or paragraph-length.
  if (s.length > 90) return false;
  if (s.split(/\s+/).length > 12) return false;

  // Strip a leading section number so "3.1 Related Work" and "Related Work"
  // reach the keyword check identically.
  const rest = s.replace(NUMBERING, "").trim();
  if (!rest) return false;

  // Named section: "Abstract", "3.1 Related Work", "METHODS:", ...
  const kw = rest.match(SECTION_KEYWORD);
  if (kw) {
    // Accept only when the keyword IS the heading, either the whole line
    // (bar trailing ":"/"."), or a short title-cased phrase like "Related
    // Work". A sentence that just opens with a keyword ("Prior work was
    // limited.", "Results showed improvements") is title-cased-false and
    // stays body text.
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

  // A numbered title that isn't a numbered sentence: "4 Experimental Setup".
  // Requires a capitalized start and no terminal sentence punctuation, so
  // "4. We then trained the model." stays body text.
  if (hadNumber && /^[A-Z(]/.test(rest) && !/[.?!,;]$/.test(rest)) {
    return true;
  }

  // An ALL-CAPS banner heading: "RESULTS", "SYSTEM DESIGN". Needs to be all
  // uppercase, contain letters, and avoid sentence punctuation.
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

/**
 * Splits document text into `[{ heading, text }]` on detected section
 * headings. `heading` is the heading line (markdown `#`s stripped), or `null`
 * for any leading preamble that precedes the first heading. `text` is that
 * section's body with the heading line itself removed.
 *
 * Returns `null` when no heading is detected at all, signaling callers to fall
 * back to plain character chunking rather than treat the whole document as one
 * headingless section.
 */
export function splitIntoSections(text) {
  const lines = (text || "").split("\n");
  const sections = [];
  let current = { heading: null, lines: [] };
  let headingCount = 0;

  const commit = () => {
    // Keep a section only if it has a heading or some body, this drops the
    // empty preamble that precedes a document opening straight into a heading.
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

/**
 * Heading-aware replacement for chunkText: returns an array of chunk strings,
 * each ≤ maxChars, that break on section boundaries instead of mid-section.
 * Consecutive small sections are packed together up to the budget so a
 * many-section document doesn't fan out into one tiny model call per heading;
 * an oversized single section is character-split, with its heading kept on the
 * first piece for context. Falls back to plain chunkText for unstructured
 * documents. Signature matches chunkText so it drops into summarizeText's
 * injectable `chunkTextFn` seam.
 */
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
    // Re-attach the heading to its body so the model sees which section it's
    // summarizing ("Methods" vs "Results").
    const block = section.heading
      ? `${section.heading}\n${section.text}`.trim()
      : section.text;
    if (!block) continue;

    if (block.length > limit) {
      flush();
      for (const piece of chunkText(block, limit)) chunks.push(piece);
      continue;
    }

    // +2 accounts for the "\n\n" joiner added when packing sections together.
    if (buffer && buffer.length + 2 + block.length > limit) flush();
    buffer = buffer ? `${buffer}\n\n${block}` : block;
  }
  flush();

  return chunks;
}
