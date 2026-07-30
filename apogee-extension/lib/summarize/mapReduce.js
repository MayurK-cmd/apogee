// The map/reduce-over-chunks skeleton shared by ollamaSummarize.js's
// summarizeText and youtubeSummarize.js's summarizeYoutube. Both used to carry
// their own copy of the identical dance — clean, chunk, cap to the model's
// fan-out budget, a single-chunk fast path, a map pass per chunk, then a reduce
// pass — differing ONLY in which prompts they build at each stage and how they
// chunk. That shared machinery (including the target-language streaming wrapper
// and the abort checks the tests pin down) lives here once; the two callers now
// supply just the three prompt builders.
//
// The chunker, chat stream, progress hook, and language seams stay caller-
// injected (they carry per-caller defaults and the tests' fakes) — this only
// owns the control flow between them.

import { cleanText } from "./cleaner.js";
import { getMaxChunkChars, getMaxChunks } from "../engines/modelLimits.js";
import { streamInTargetLanguage } from "../language/languageOutput.js";

// Evenly-spaced pick across the whole list, preserving order. Used when a
// document has more chunks than the model's fan-out budget allows: sampling
// across it means the middle and end are represented, not just the head (the
// old chunks.slice(0, k), which silently dropped the rest of a long document).
// Always includes the first chunk (i = 0).
function stratifiedSample(chunks, k) {
  if (chunks.length <= k) return chunks;
  const step = chunks.length / k;
  const picked = [];
  for (let i = 0; i < k; i++) picked.push(chunks[Math.floor(i * step)]);
  return picked;
}

/**
 * Async-generator yielding the final summary's tokens.
 *
 * `stage` holds `{ text, model, host, signal, language }`. `seams` holds the
 * injected `chunkTextFn`/`chatStreamFn`/`onProgress`/`detectLanguageFn`/
 * `translateFn`, plus an optional `selectChunksFn(chunks, k) -> chunks|null`
 * that picks the k most representative chunks of an over-long document
 * (embedding-salience, see selectSalientChunks); when absent or it returns
 * null, stratified sampling is used instead. `prompts` holds the three
 * per-caller builders:
 *   - buildSingle(chunk)                    → prompt for a one-chunk input
 *   - buildMap(chunk, index, total)         → prompt for one chunk's map pass
 *   - buildReduce(partials)                 → prompt merging the map outputs
 * buildReduce receives the array of trimmed per-chunk outputs (so it can key
 * off partials.length, e.g. to scale a bullet target), not a joined string.
 */
export async function* mapReduceStream(
  { text, model, host, signal, language },
  {
    chunkTextFn,
    chatStreamFn,
    onProgress,
    detectLanguageFn,
    translateFn,
    selectChunksFn,
  },
  { buildSingle, buildMap, buildReduce },
) {
  const cleaned = cleanText(text);
  let chunks = chunkTextFn(cleaned, getMaxChunkChars(model));

  // A document with more chunks than the model's fan-out budget can't all be
  // summarized (re-chunking at content/maxChunks is unbounded and blows past
  // WebLLM's hard 4096-token window, burying the CPU engines in quadratically
  // slower prefills that look like a freeze). Rather than keep only the first
  // maxChunks and drop the rest of a long document, SELECT maxChunks that
  // cover it: the injected salience selector when available, else an even
  // stratified sample across the whole document.
  const maxChunks = getMaxChunks(model);
  if (chunks.length > maxChunks) {
    onProgress?.({ stage: "truncated", kept: maxChunks, total: chunks.length });
    let selected = null;
    if (selectChunksFn) {
      try {
        selected = await selectChunksFn(chunks, maxChunks);
      } catch {
        selected = null;
      }
    }
    chunks =
      Array.isArray(selected) && selected.length
        ? selected
        : stratifiedSample(chunks, maxChunks);
  }
  if (signal?.aborted) return;

  // Errors are left to propagate: the caller (service-worker.js's buffered
  // stream runner / offscreen.js's runStream) catches them and emits a clean
  // `type:"error"` message.

  // Emits the final summary in the target language via the shared single-pass
  // (system directive) + verify + translate-fallback strategy (see
  // lib/language/languageOutput.js). `language` is already resolved to "auto"
  // by the caller when the page is in the target language, so no work is wasted.
  const chat = (prompt, opts) => chatStreamFn(host, model, prompt, opts);
  const streamFinal = (finalPrompt) =>
    streamInTargetLanguage(chat, finalPrompt, language, {
      signal,
      detectLanguageFn,
      translateFn,
      onFallback: () => onProgress?.({ stage: "translate" }),
    });

  // Single chunk: skip the map stage, summarize/assemble in one pass.
  if (chunks.length <= 1) {
    if (signal?.aborted) return;
    yield* streamFinal(buildSingle(chunks[0] || ""));
    return;
  }

  // Map every chunk, then run a single reduce/synthesis pass over all the map
  // outputs together (rather than concatenating them) so points recurring
  // across chunks get merged into one.
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return;
    onProgress?.({ stage: "map", index: i, total: chunks.length });
    let partial = "";
    for await (const token of chatStreamFn(
      host,
      model,
      buildMap(chunks[i], i, chunks.length),
      { signal },
    )) {
      partial += token;
    }
    partials.push(partial.trim());
  }

  if (signal?.aborted) return;
  onProgress?.({ stage: "reduce" });
  yield* streamFinal(buildReduce(partials));
}
