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
import { timestampToSeconds } from "./timestamps.js";
import { detectPrimaryLanguage } from "../language/detectLanguage.js";
import { cleanText } from "./cleaner.js";
import { chatStream } from "../engines/ollamaClient.js";
import { mapReduceStream } from "./mapReduce.js";

// Matches the [MM:SS] / [H:MM:SS] markers content/extractors/youtube.js
// threads through the transcript text, used to find the anti-hallucination
// ceiling passed to buildYoutubeAssemblyPrompt.
const TIMESTAMP_MARKER = /\[(\d{1,2}(?::\d{2}){1,2})\]/g;

function lastAvailableSecondsIn(text) {
  let last = 0;
  for (const match of text.matchAll(TIMESTAMP_MARKER)) {
    const seconds = timestampToSeconds(match[1]);
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

  // Shared clean/chunk/cap + map/reduce + target-language machinery (see
  // mapReduceStream). YouTube's only departures from the article path are the
  // prompts: the single-chunk and reduce passes both ASSEMBLE (buildAssembly —
  // a flat brief, or a chaptered one when the description defined chapters),
  // while each chunk's map pass emits timestamped notes. The system directive /
  // buildTranslatePrompt keep the [MM:SS](url) deep-links intact across the
  // target-language pass.
  yield* mapReduceStream(
    { text: transcriptContent, model, host, signal, language },
    { chunkTextFn, chatStreamFn, onProgress, detectLanguageFn, translateFn },
    {
      buildSingle: (chunk) => buildAssembly(chunk),
      buildMap: (chunk, i, total) =>
        buildYoutubeMapPrompt(title, chunk, i, total),
      buildReduce: (notes) => buildAssembly(notes.join("\n")),
    },
  );
}
