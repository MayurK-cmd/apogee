// Lightweight source-language detection, used only to decide whether the
// summarize→translate pass (see lib/ollamaSummarize.js) is actually needed:
// when the article is already in the user's target language (e.g. an English
// page with the default English target), translating it again is a wasteful,
// quality-risking identity pass, so it's skipped. Uses chrome.i18n.detectLanguage
// (CLD, fully local, no permission, no model download); available in extension
// service workers, offscreen documents, and Firefox's background page.

import { resolveLanguageName } from "./prompts.js";

// "en-US" -> "en", "zh-Hant" -> "zh". Just enough to compare a detected BCP-47
// tag against a summaryLanguage code's base.
function baseCode(code) {
  return (code || "").toLowerCase().split("-")[0];
}

// Whether a detected language tag is (close enough to) the target summary
// language, comparing by base code. Used to verify a single-pass generation
// actually came out in the target before skipping the translate fallback (see
// streamFinal in lib/ollamaSummarize.js). Simplified/Traditional Chinese share
// the "zh" base, the same known limitation as resolveEffectiveLanguage.
export function detectedMatchesTarget(detected, target) {
  return !!detected && baseCode(detected) === baseCode(target);
}

// Highest-confidence detected language for `text`, or null when detection is
// unavailable or too unsure to act on. Deliberately conservative: an unsure
// result returns null so the caller errs toward translating (correctness over
// skipping) rather than silently leaving a summary in the wrong language.
export async function detectPrimaryLanguage(text) {
  try {
    const i18n = globalThis.chrome?.i18n || globalThis.browser?.i18n;
    if (!i18n?.detectLanguage) return null;
    const sample = (text || "").slice(0, 2000).trim();
    if (!sample) return null;
    const result = await i18n.detectLanguage(sample);
    const langs = result?.languages || [];
    if (!langs.length) return null;
    const top = langs.reduce((a, b) => (b.percentage > a.percentage ? b : a));
    // Below ~50% confidence the guess isn't worth acting on.
    return top.percentage >= 50 ? top.language : null;
  } catch {
    return null;
  }
}

// Resolves the language to actually hand summarizeText: the target itself when
// a translation is warranted, or "auto" (no translation, no directive — summary
// stays in the source language) when the target is unset OR the source already
// matches the target. "auto"/unknown targets short-circuit without detecting.
//
// Note: Simplified vs Traditional Chinese share the "zh" base, so a zh-hant
// target over a zh source is (for now) treated as already-matching and not
// re-translated; acceptable until per-script handling is added.
export async function resolveEffectiveLanguage(text, targetLang) {
  if (!resolveLanguageName(targetLang)) return "auto";
  const source = await detectPrimaryLanguage(text);
  if (source && baseCode(source) === baseCode(targetLang)) return "auto";
  return targetLang;
}
