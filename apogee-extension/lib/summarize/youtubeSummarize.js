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
  withCustomInstructions,
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

// Upper bound on the map-stage chunk size for a transcript, independent of the
// model's context budget. getMaxChunkChars (lib/engines/modelLimits.js) hands a
// big-context model, Ollama's practical budget reaches ~88k chars/chunk, a
// window large enough to fit an ENTIRE long transcript in a single chunk. That
// chunk then takes mapReduceStream's single-chunk fast path, which feeds the raw
// transcript straight into buildYoutubeAssemblyPrompt, a prompt written to
// consume already-extracted timestamped NOTES, not a 20k-char transcript. A
// small local model handed the whole raw transcript front-loads: it paraphrases
// the opening and stops (echoing the transcript's own inline [MM:SS] markers
// rather than emitting the mandated [MM:SS](url) deep-links, a tell the map
// stage never ran), so a 23-minute video came back summarized only through
// ~1:15. Capping the chunk size forces any substantial transcript into several
// bounded map passes whose notes the assembly step then merges, restoring
// full-video coverage. The cap is the largest chunk the in-browser engines
// already map cleanly (WebLLM's per-chunk budget, 4096-token window minus
// reserve, ×4 chars/token), so WebLLM/Transformers chunk boundaries are
// unchanged and only oversized big-context chunks get reined in.
const YOUTUBE_MAP_CHUNK_CHARS = 8192;

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
  { text, title, url, mode, model, host, signal, language, customInstructions },
  {
    chunkTextFn = chunkText,
    chatStreamFn = chatStream,
    onProgress,
    detectLanguageFn = detectPrimaryLanguage,
    translateFn,
  } = {},
) {
  const cleanedContent = cleanText(text);

  // Cap the transcript's map-stage chunk size (see YOUTUBE_MAP_CHUNK_CHARS) so a
  // long video on a big-context model is split into several map passes instead
  // of collapsing into one raw-transcript assembly pass. The injected chunkTextFn
  // still owns the actual splitting; we only bound the size it's asked for.
  const cappedChunkTextFn = (t, maxChars) =>
    chunkTextFn(t, Math.min(maxChars, YOUTUBE_MAP_CHUNK_CHARS));

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

  // buildAssembly produces the FINAL summary prompt (flat or chaptered), so
  // the user's custom instructions ride along here; the per-chunk map prompt
  // (buildYoutubeMapPrompt) stays untouched, its notes feed this step, not the
  // reader.
  const buildAssembly = (noteText) =>
    withCustomInstructions(
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
          ),
      customInstructions,
    );

  // Shared clean/chunk/cap + map/reduce + target-language machinery (see
  // mapReduceStream). YouTube's only departures from the article path are the
  // prompts: the single-chunk and reduce passes both ASSEMBLE (buildAssembly,
  // a flat brief, or a chaptered one when the description defined chapters),
  // while each chunk's map pass emits timestamped notes. The system directive /
  // buildTranslatePrompt keep the [MM:SS](url) deep-links intact across the
  // target-language pass.
  yield* mapReduceStream(
    { text: transcriptContent, model, host, signal, language },
    {
      chunkTextFn: cappedChunkTextFn,
      chatStreamFn,
      onProgress,
      detectLanguageFn,
      translateFn,
    },
    {
      buildSingle: (chunk) => buildAssembly(chunk),
      buildMap: (chunk, i, total) =>
        buildYoutubeMapPrompt(title, chunk, i, total),
      buildReduce: (notes) => buildAssembly(notes.join("\n")),
    },
  );
}
