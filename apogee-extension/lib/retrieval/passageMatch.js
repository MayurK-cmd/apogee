// Locates a chunk of (verbatim, Readability-extracted) page text within the
// live page's own text, tolerating whitespace/case differences between the
// two. Pure string offsets, no DOM access at all, that's what makes this
// unit-testable and shareable between the content script (which maps the
// result onto real DOM nodes, see content/highlight.js) and its own tests.

// Escapes regex metacharacters in `str` so it can be embedded literally in
// a RegExp source string.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Upper bound on the length of text turned into a matcher. The needle comes
// from page-derived content (a retrieved passage), so cap it defensively:
// building a regex from an unbounded string, and running it over the whole
// page text, is wasted work at best, and a long alternation of `\s+`-joined
// tokens is the kind of pattern that can pin the regex engine at worst. A
// too-long needle returns no matcher here; findMatchingRange then falls through
// to its shorter sentence/prefix tiers, which are well within this bound.
const MAX_MATCH_TEXT_CHARS = 1500;

// Builds a case-insensitive RegExp that matches `text` against a haystack
// while tolerating any run of whitespace wherever `text` itself has one.
// Readability's extraction and the live DOM's actual rendered text can
// differ in exact whitespace even when the underlying words match; using a
// regex like this, rather than first collapsing whitespace in both strings
// and searching *that*, is what lets a successful match's offsets map
// directly back onto the *original*, unmodified haystack. Collapsing
// whitespace up front would shift every offset after the first collapsed
// run, breaking that correspondence, which the caller needs intact to
// locate the match in the live DOM afterward.
function buildFlexibleMatcher(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_MATCH_TEXT_CHARS) return null;
  const escaped = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
  if (!escaped) return null;
  try {
    return new RegExp(escaped, "i");
  } catch {
    return null;
  }
}

function tryMatch(haystack, text) {
  const re = buildFlexibleMatcher(text);
  if (!re) return null;
  const match = re.exec(haystack);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

// Splits `text` into sentence-ish spans (on sentence-ending punctuation or
// blank lines), longest first, so findMatchingRange's fallback tiers try
// the most specific/reliable spans before giving up.
function splitIntoSpans(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

// Short enough that a prefix window still reads as a real quote, not just a
// handful of words, but forgiving of a full-chunk/full-sentence match
// failing because the divergence between extracted and live text happens
// to fall early.
const PREFIX_WINDOW_CHARS = 180;

/**
 * Locates `chunkText` (or the closest reasonable approximation of it)
 * within `pageText`. Tries, in order: the full chunk verbatim, then its
 * sentences (longest first), then a short prefix window, returning `null`
 * if none of those are found anywhere in `pageText`. Returns `{start, end}`
 * character offsets into `pageText` on success.
 */
export function findMatchingRange(pageText, chunkText) {
  const haystack = pageText || "";
  const needle = (chunkText || "").trim();
  if (!haystack || !needle) return null;

  const full = tryMatch(haystack, needle);
  if (full) return full;

  for (const span of splitIntoSpans(needle)) {
    const spanMatch = tryMatch(haystack, span);
    if (spanMatch) return spanMatch;
  }

  const prefix = needle.slice(0, PREFIX_WINDOW_CHARS);
  if (prefix.length < needle.length) {
    return tryMatch(haystack, prefix);
  }
  return null;
}
