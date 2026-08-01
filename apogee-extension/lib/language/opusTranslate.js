// Opus-MT (Helsinki-NLP) translation model resolution + structure-preserving
// line translation, for the opt-in "opus" translation engine (see the
// translationEngine setting). Opus-MT is English-centric: it has small,
// dedicated per-pair models (~80MB) for common languages, plus two grouped
// models, en-mul (English -> 120 languages, via a >>code<< target token) and
// mul-en (many -> English), that fill the gaps, including the low-resource
// languages the small summarization LLMs are weakest at. Languages Opus-MT
// can't reach at all fall back to the LLM translate pass (see
// lib/languageOutput.js). Pure logic here; the ONNX engine lives in
// lib/transformersEngine.js and the wiring in the offscreen/background hosts.

// summaryLanguage code -> Opus-MT grouped-model target token (the ">>xxx<<"
// prefix opus-mt-en-mul requires). Only codes en-mul actually supports are
// listed; anything absent (sk, ko, zh-hant) has no Opus path and falls back to
// the LLM translate. Verified against the opus-mt-en-mul model card.
const EN_MUL_TOKEN = {
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  pt: "por",
  nl: "nld",
  pl: "pol",
  ru: "rus",
  uk: "ukr",
  cs: "ces",
  sl: "slv",
  bg: "bul",
  ro: "ron",
  hu: "hun",
  el: "ell",
  tr: "tur",
  sv: "swe",
  da: "dan",
  nb: "nob",
  fi: "fin",
  et: "est",
  lv: "lav",
  lt: "lit",
  ja: "jpn",
  zh: "cmn",
  id: "ind",
};

// summaryLanguage codes with a dedicated Xenova/opus-mt-en-<code> ONNX model
// (small, higher quality than the grouped model). Verified against the Xenova
// model listing. `ja` uses the "jap" spelling in its model id, handled below.
const DIRECT_EN_TO = new Set([
  "es",
  "fr",
  "de",
  "it",
  "nl",
  "ru",
  "uk",
  "cs",
  "ro",
  "sv",
  "da",
  "fi",
  "hu",
  "zh",
  "id",
  "ja",
]);

// summaryLanguage codes with a dedicated Xenova/opus-mt-<code>-en ONNX model.
const DIRECT_TO_EN = new Set([
  "es",
  "fr",
  "de",
  "it",
  "nl",
  "ru",
  "uk",
  "cs",
  "fi",
  "sv",
  "da",
  "zh",
  "id",
  "ja",
  "ko",
  "tr",
  "et",
  "hu",
  "pl",
]);

// Model ids whose Opus code differs from our summaryLanguage code.
const DIRECT_MODEL_CODE = { ja: "jap" };

function directCode(lang) {
  return DIRECT_MODEL_CODE[lang] || lang;
}

/**
 * Resolves the Opus-MT model to translate `src` -> `tgt` (both summaryLanguage
 * codes). Returns `{ model, token }` where `token` is the ">>xxx<< " prefix for
 * grouped models (empty for direct pairs), or `null` when Opus-MT can't do this
 * pair and the caller must fall back to the LLM translate.
 *
 * Opus-MT is English-centric, so only English<->X pairs are supported directly;
 * a non-English <-> non-English pair (rare here) returns null -> LLM fallback.
 */
export function resolveOpusModel(src, tgt) {
  if (!src || !tgt || src === tgt) return null;

  if (src === "en") {
    if (DIRECT_EN_TO.has(tgt)) {
      return { model: `Xenova/opus-mt-en-${directCode(tgt)}`, token: "" };
    }
    if (EN_MUL_TOKEN[tgt]) {
      return {
        model: "Xenova/opus-mt-en-mul",
        token: `>>${EN_MUL_TOKEN[tgt]}<< `,
      };
    }
    return null;
  }

  if (tgt === "en") {
    if (DIRECT_TO_EN.has(src)) {
      return { model: `Xenova/opus-mt-${directCode(src)}-en`, token: "" };
    }
    // mul-en is the catch-all many->English model.
    return { model: "Xenova/opus-mt-mul-en", token: "" };
  }

  // Non-English <-> non-English: not handled here (would need pivoting).
  return null;
}

// Splits a summary/answer line into a leading non-translatable prefix (a
// markdown heading marker and/or a bullet/number marker, then an optional
// "[label](url)" jump-link) and the translatable remainder, so line-by-line MT
// never rewrites list/heading structure or deep-links. This covers all the
// shapes Apogee emits: the key-moments bullet "- [MM:SS](url): text", the
// chaptered-brief heading "### [MM:SS](url) Title", and plain "## Section"
// headings. The link's trailing ":" is optional, so the space-separated heading
// form (no colon) is peeled the same as the colon-terminated bullet form;
// without this a chapter heading's URL was fed to the translator and mangled.
// A bare "[label](url)" mid-line is left in place (Opus keeps most tokens it
// doesn't recognize); only the structural leading prefix is peeled off.
const LEADING_PREFIX =
  /^(\s*(?:#{1,6}\s+|[-*]\s+|\d+\.\s+)?(?:\[[^\]]*\]\([^)]*\):?\s*)?)/;

export function splitTranslatablePrefix(line) {
  const match = line.match(LEADING_PREFIX);
  const prefix = match ? match[0] : "";
  return { prefix, rest: line.slice(prefix.length) };
}

// How many lines to hand the translator per batched call. Small enough to keep
// each seq2seq pass responsive (and to report progress between batches),
// large enough that batching's per-call overhead is amortized.
const TRANSLATE_BATCH_SIZE = 8;

/**
 * Translates multi-line `text` via `translateBatch` (a function that maps an
 * array of strings to their translations, in order), preserving blank lines and
 * each line's structural prefix (bullets, timestamp links). Lines with no
 * translatable text are passed through untouched. Translatable lines are grouped
 * into batches (see TRANSLATE_BATCH_SIZE) so a summary is translated in a few
 * batched passes instead of one serial call per line. `onProgress(done, total)`
 * (optional) fires after each batch with the running count of translated lines,
 * so callers can surface real "Translating n/total…" progress instead of a
 * frozen label. Errors from `translateBatch` propagate to the caller.
 */
export async function translatePreservingStructure(
  text,
  translateBatch,
  { onProgress, batchSize = TRANSLATE_BATCH_SIZE } = {},
) {
  const lines = text.split("\n");
  const parts = lines.map(splitTranslatablePrefix);
  // Indices (and prose) of the lines that actually need translation.
  const jobs = [];
  parts.forEach((p, i) => {
    if (p.rest.trim()) jobs.push({ i, rest: p.rest });
  });
  // Group similar-length lines together: a batch decodes until its LONGEST
  // member finishes, so mixing a one-liner with a long paragraph makes the
  // short line pay the long line's decode length. Sorting by length first keeps
  // each batch length-homogeneous. Output order is restored via `j.i` below, so
  // reordering here is safe.
  jobs.sort((a, b) => a.rest.length - b.rest.length);

  // Non-translatable lines (blank / prefix-only) pass through unchanged.
  const out = lines.slice();
  let done = 0;
  for (let start = 0; start < jobs.length; start += batchSize) {
    const chunk = jobs.slice(start, start + batchSize);
    const translated = await translateBatch(chunk.map((j) => j.rest));
    chunk.forEach((j, k) => {
      // Fall back to the original prose (not "") when the model returns fewer
      // lines than the batch: a missing translation should leave the line as
      // untranslated source text, not collapse it to a prefix-only empty bullet.
      out[j.i] = parts[j.i].prefix + (translated[k] ?? j.rest);
    });
    done += chunk.length;
    onProgress?.(done, jobs.length);
  }
  return out.join("\n");
}
