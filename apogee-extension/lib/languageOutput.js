// Shared "produce this output in the target language" strategy, used by every
// user-visible generation that honors the summaryLanguage setting: summaries
// (lib/ollamaSummarize.js, lib/youtubeSummarize.js), ask answers, and suggested
// questions. Runs ONE generation with a system-role language directive
// (weighted heavily by instruct models), verifies the output actually came out
// in the target language, and only falls back to an explicit translate pass if
// the model slipped. An inline "write in X" directive on the prompt was tried
// first and ignored by the small in-browser models, hence system + verify +
// translate. See buildLanguageSystemPrompt (lib/prompts.js) and
// lib/detectLanguage.js.

import {
  buildLanguageSystemPrompt,
  buildTranslatePrompt,
  resolveLanguageName,
} from "./prompts.js";
import {
  detectPrimaryLanguage,
  detectedMatchesTarget,
} from "./detectLanguage.js";

/**
 * Streams `prompt`'s completion in the target language.
 *
 * `chatFn(prompt, { signal, system })` must return an async iterable of text
 * tokens; the `system` option (when present) becomes a system message. When
 * `language` resolves to no real language ("auto"/unknown), the prompt is
 * streamed straight through with no directive, verification, or fallback.
 *
 * `onFallback` (optional) is invoked once, right before a translate step runs,
 * so callers can surface a "Translating..." progress label.
 *
 * `translateFn` (optional) selects the dedicated-MT mode (the opt-in Opus-MT
 * engine): when present, the prompt is generated neutrally and then translated
 * by `translateFn(text, language) -> string | null`. A null result means that
 * engine can't cover the language, so it falls back to the LLM translate. When
 * absent, the LLM does everything: one system-directive pass, verified, with an
 * LLM translate fallback only if it slipped.
 */
export async function* streamInTargetLanguage(
  chatFn,
  prompt,
  language,
  {
    signal,
    detectLanguageFn = detectPrimaryLanguage,
    onFallback,
    translateFn,
  } = {},
) {
  const target = resolveLanguageName(language) ? language : null;
  if (!target) {
    yield* chatFn(prompt, { signal });
    return;
  }

  // Dedicated-MT mode: generate neutrally (source/English), then translate the
  // finished text with a real translation model, deterministic, and stronger
  // on low-resource languages than the summarization LLM.
  if (translateFn) {
    let out = "";
    for await (const token of chatFn(prompt, { signal })) out += token;
    if (signal?.aborted) return;
    out = out.trim();
    if (!out) {
      yield out;
      return;
    }
    onFallback?.();
    const translated = await translateFn(out, target);
    if (translated != null) {
      yield translated;
      return;
    }
    // The MT engine doesn't cover this language, fall back to the LLM.
    yield* chatFn(buildTranslatePrompt(out, target), { signal });
    return;
  }

  // LLM mode. First pass: force the language via a system message, buffered so
  // its language can be checked before anything is shown (a fallback would
  // otherwise have to replace already-streamed source-language text).
  let out = "";
  for await (const token of chatFn(prompt, {
    signal,
    system: buildLanguageSystemPrompt(target),
  })) {
    out += token;
  }
  if (signal?.aborted) return;
  out = out.trim();

  // Verify: emit as-is when it's already in the target language (fast path).
  const detected = await detectLanguageFn(out);
  if (!out || detectedMatchesTarget(detected, target)) {
    yield out;
    return;
  }

  // Fallback: the model ignored the system directive, translate explicitly.
  onFallback?.();
  yield* chatFn(buildTranslatePrompt(out, target), { signal });
}

/** Buffered variant for non-streaming callers (e.g. suggested questions). */
export async function generateInTargetLanguage(chatFn, prompt, language, opts) {
  let out = "";
  for await (const token of streamInTargetLanguage(
    chatFn,
    prompt,
    language,
    opts,
  )) {
    out += token;
  }
  return out;
}
