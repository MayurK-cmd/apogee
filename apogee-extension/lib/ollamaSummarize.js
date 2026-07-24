// Client-side port of apogee-backend/src/services/summaryService.js, driving
// ollamaClient.chatStream directly instead of relaying through the Node
// backend. Mirrors its chunking/map-reduce behavior so summaries look the
// same as they did under the old backend-relayed Local Ollama mode.

import { chunkText } from "./chunk.js";
import { buildSummaryPrompt, buildScaledBulletsStyle } from "./prompts.js";
import { cleanText } from "./cleaner.js";
import { chatStream } from "./ollamaClient.js";
import { getMaxChunkChars } from "./modelLimits.js";
import { summarizeYoutube } from "./youtubeSummarize.js";

// Upper bound on how many chunks (== sequential model calls) a single summary
// may fan out into, mirrors summaryService.js's MAX_CHUNKS.
export const MAX_CHUNKS = 12;

/**
 * Async-generator yielding summary tokens for the given text via Ollama.
 * `chunkTextFn`/`chatStreamFn` are injectable seams for tests; `onProgress`
 * is an optional UI hook (used by the WebLLM offscreen path to surface
 * "Summarizing part N of M..." during the otherwise-silent map phase).
 * It receives `{ stage: "map", index, total }` per chunk and
 * `{ stage: "reduce" }` before the final merge.
 */
export async function* summarizeText(
  { text, title, url, mode, model, host, signal, type },
  { chunkTextFn = chunkText, chatStreamFn = chatStream, onProgress } = {},
) {
  // YouTube still honors `mode`, but always runs a single map+assemble pass
  // with timestamp links woven through. See youtubeSummarize.js's own
  // module comment for why that's a separate pipeline rather than another
  // branch here.
  if (type === "youtube") {
    yield* summarizeYoutube(
      { text, title, url, mode, model, host, signal },
      { chunkTextFn, chatStreamFn, onProgress },
    );
    return;
  }

  const cleanedContent = cleanText(text);
  let chunks = chunkTextFn(cleanedContent, getMaxChunkChars(model));
  if (chunks.length > MAX_CHUNKS) {
    let biggerSize = Math.ceil(cleanedContent.length / MAX_CHUNKS);
    chunks = chunkTextFn(cleanedContent, biggerSize);
    while (chunks.length > MAX_CHUNKS) {
      biggerSize *= 2;
      chunks = chunkTextFn(cleanedContent, biggerSize);
    }
  }

  // Errors are left to propagate: the caller (service-worker.js's buffered
  // stream runner) catches them and emits a clean `type:"error"` message,
  // same as offscreen.js's runStream does for WebLLM failures.

  // --- Single chunk: stream tokens directly ---
  if (chunks.length <= 1) {
    const prompt = buildSummaryPrompt(title, url, chunks[0] || "", mode);
    yield* chatStreamFn(host, model, prompt, { signal });
    return;
  }

  // Map every chunk in the requested mode, then run a final reduce/synthesis
  // pass over all chunk summaries together (also in that mode) rather than
  // just concatenating them, so points that show up in more than one chunk
  // get deduplicated into one. Mirrors youtubeSummarize.js's map+assemble
  // shape. Bullets' reduce pass uses a scaled point-count target (see
  // buildScaledBulletsStyle) instead of the base style's fixed 8-14, since
  // that's meant for a single pass, not a merge of many chunks' worth of
  // content.
  const chunkSummaries = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return;
    onProgress?.({ stage: "map", index: i, total: chunks.length });
    const prompt = buildSummaryPrompt(title, url, chunks[i], mode);
    let partial = "";
    for await (const token of chatStreamFn(host, model, prompt, { signal })) {
      partial += token;
    }
    chunkSummaries.push(partial.trim());
  }

  if (signal?.aborted) return;
  onProgress?.({ stage: "reduce" });
  const combinedText = chunkSummaries.join("\n");
  const styleOverride =
    mode === "bullets" ? buildScaledBulletsStyle(chunks.length) : undefined;
  const mergePrompt = buildSummaryPrompt(
    title,
    url,
    combinedText,
    mode,
    styleOverride,
  );
  yield* chatStreamFn(host, model, mergePrompt, { signal });
}
