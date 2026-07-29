// YouTube-specific summarization: the same bullets/sentences/paragraphs
// `mode` ordinary pages get, but with inline [MM:SS] jump-to-video links
// woven through the notes and final summary, inspired by
// github.com/tantara/openbrief's YouTube summarizer. When the video's
// description defines real chapter markers, the final pass instead assembles
// an OpenBrief-style chaptered brief (overview + per-chapter sections + key
// takeaways, see buildYoutubeBriefPrompt / lib/youtubeChapters.js). Split into its own
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
  buildYoutubeBriefPrompt,
} from "./prompts.js";
import { parseChaptersBlock, stripChaptersBlock } from "./youtubeChapters.js";
import { detectPrimaryLanguage } from "../language/detectLanguage.js";
import { streamInTargetLanguage } from "../language/languageOutput.js";
import { cleanText } from "./cleaner.js";
import { chatStream } from "../engines/ollamaClient.js";
import { getMaxChunkChars, getMaxChunks } from "../engines/modelLimits.js";

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
  { text, title, url, mode, model, host, signal, language },
  {
    chunkTextFn = chunkText,
    chatStreamFn = chatStream,
    onProgress,
    detectLanguageFn = detectPrimaryLanguage,
    translateFn,
  } = {},
) {
  const cleanedContent = cleanText(text);

  // When the video's description defined real chapter markers, the extractor
  // embeds them as a "Chapters:" block (see lib/youtubeChapters.js). Peel it
  // off the transcript text so it isn't summarized as content, and switch the
  // final assembly to an OpenBrief-style chaptered brief; with no chapters,
  // both stay at the flat bullets/sentences/paragraphs behavior.
  const chapters = parseChaptersBlock(cleanedContent);
  const transcriptContent = chapters.length
    ? stripChaptersBlock(cleanedContent)
    : cleanedContent;
  const lastAvailableSeconds = lastAvailableSecondsIn(transcriptContent);

  const buildAssembly = (noteText) =>
    chapters.length
      ? buildYoutubeBriefPrompt(
          title,
          url,
          noteText,
          chapters,
          lastAvailableSeconds,
        )
      : buildYoutubeAssemblyPrompt(
          title,
          url,
          noteText,
          lastAvailableSeconds,
          mode,
        );

  let chunks = chunkTextFn(transcriptContent, getMaxChunkChars(model));
  // Truncate rather than grow chunks past the model's context budget, same
  // rationale as summarizeText's identical block (see ollamaSummarize.js).
  const maxChunks = getMaxChunks(model);
  if (chunks.length > maxChunks) {
    onProgress?.({ stage: "truncated", kept: maxChunks, total: chunks.length });
    chunks = chunks.slice(0, maxChunks);
  }

  // Errors are left to propagate, same as summarizeText: the caller
  // (service-worker.js's buffered stream runner / offscreen.js's runStream)
  // catches them and emits a clean `type:"error"` message.

  // Same shared single-pass (system directive) + verify + translate-fallback
  // strategy as summarizeText (see lib/languageOutput.js). Whichever path runs,
  // the system directive / buildTranslatePrompt keep the [MM:SS](url) timestamp
  // deep-links intact.
  const chat = (prompt, opts) => chatStreamFn(host, model, prompt, opts);
  function streamFinal(finalPrompt) {
    return streamInTargetLanguage(chat, finalPrompt, language, {
      signal,
      detectLanguageFn,
      translateFn,
      onFallback: () => onProgress?.({ stage: "translate" }),
    });
  }

  // Short video, one chunk: skip the map stage and assemble straight from
  // the raw timestamped transcript, no intermediate notes to lose fidelity.
  if (chunks.length <= 1) {
    if (signal?.aborted) return;
    yield* streamFinal(buildAssembly(chunks[0] || ""));
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
  yield* streamFinal(buildAssembly(notes.join("\n")));
}
