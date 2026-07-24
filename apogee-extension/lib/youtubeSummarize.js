// YouTube-specific summarization: the same bullets/sentences/paragraphs
// `mode` ordinary pages get, but with inline [MM:SS] jump-to-video links
// woven through the notes and final summary, inspired by
// github.com/tantara/openbrief's YouTube summarizer. Split into its own
// module (rather than folded into ollamaSummarize.js's summarizeText)
// because it always runs the same map+assemble shape regardless of `mode`
// (a single synthesis pass that sees every chunk's notes at once), unlike
// summarizeText's three mode-dependent chunking/merge branches.
//
// Reuses summarizeText's chunking (lib/chunk.js, sized per-model via
// lib/modelLimits.js) so the map stage's chunk boundaries land in the same
// places a plain-text summary's would.

import { chunkText } from "./chunk.js";
import {
  buildYoutubeMapPrompt,
  buildYoutubeAssemblyPrompt,
} from "./prompts.js";
import { cleanText } from "./cleaner.js";
import { chatStream } from "./ollamaClient.js";
import { getMaxChunkChars } from "./modelLimits.js";

// Upper bound on how many chunks (== sequential model calls) a single
// summary may fan out into. Mirrors ollamaSummarize.js's own MAX_CHUNKS (not
// imported from there to avoid a circular import, since ollamaSummarize.js
// imports this module's summarizeYoutube to dispatch on `type`).
const MAX_CHUNKS = 12;

// Matches the [MM:SS] / [H:MM:SS] markers content/extractors/youtube.js
// threads through the transcript text, used to find the anti-hallucination
// ceiling passed to buildYoutubeAssemblyPrompt.
const TIMESTAMP_MARKER = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g;

function lastAvailableSecondsIn(text) {
  let last = 0;
  for (const match of text.matchAll(TIMESTAMP_MARKER)) {
    const [, a, b, c] = match;
    const seconds = c
      ? Number(a) * 3600 + Number(b) * 60 + Number(c)
      : Number(a) * 60 + Number(b);
    if (seconds > last) last = seconds;
  }
  return last;
}

/**
 * Async-generator yielding the final brief's tokens. Same seam shape as
 * ollamaSummarize.js's summarizeText (`chunkTextFn`/`chatStreamFn` for
 * tests, `onProgress` for the "Summarizing part N of M..." / "Merging
 * summary..." UI hook) so both can share the same caller-side plumbing.
 */
export async function* summarizeYoutube(
  { text, title, url, mode, model, host, signal },
  { chunkTextFn = chunkText, chatStreamFn = chatStream, onProgress } = {},
) {
  const cleanedContent = cleanText(text);
  const lastAvailableSeconds = lastAvailableSecondsIn(cleanedContent);

  let chunks = chunkTextFn(cleanedContent, getMaxChunkChars(model));
  if (chunks.length > MAX_CHUNKS) {
    let biggerSize = Math.ceil(cleanedContent.length / MAX_CHUNKS);
    chunks = chunkTextFn(cleanedContent, biggerSize);
    while (chunks.length > MAX_CHUNKS) {
      biggerSize *= 2;
      chunks = chunkTextFn(cleanedContent, biggerSize);
    }
  }

  // Errors are left to propagate, same as summarizeText: the caller
  // (service-worker.js's buffered stream runner / offscreen.js's runStream)
  // catches them and emits a clean `type:"error"` message.

  // Short video, one chunk: skip the map stage and assemble straight from
  // the raw timestamped transcript, no intermediate notes to lose fidelity.
  if (chunks.length <= 1) {
    if (signal?.aborted) return;
    const prompt = buildYoutubeAssemblyPrompt(
      title,
      url,
      chunks[0] || "",
      lastAvailableSeconds,
      mode,
    );
    yield* chatStreamFn(host, model, prompt, { signal });
    return;
  }

  const notes = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return;
    onProgress?.({ stage: "map", index: i, total: chunks.length });
    const prompt = buildYoutubeMapPrompt(title, chunks[i], i, chunks.length);
    let partial = "";
    for await (const token of chatStreamFn(host, model, prompt, { signal })) {
      partial += token;
    }
    notes.push(partial.trim());
  }

  if (signal?.aborted) return;
  onProgress?.({ stage: "reduce" });
  const assemblyPrompt = buildYoutubeAssemblyPrompt(
    title,
    url,
    notes.join("\n"),
    lastAvailableSeconds,
    mode,
  );
  yield* chatStreamFn(host, model, assemblyPrompt, { signal });
}
