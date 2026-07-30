// Client-side port of apogee-backend/src/services/summaryService.js, driving
// ollamaClient.chatStream directly instead of relaying through the Node
// backend. Mirrors its chunking/map-reduce behavior so summaries look the
// same as they did under the old backend-relayed Local Ollama mode.

import { chunkBySections } from "./sections.js";
import {
  buildSummaryPrompt,
  buildDiscussionPrompt,
  buildExtractNotesPrompt,
  buildSynthesisPrompt,
  buildScaledBulletsStyle,
} from "./prompts.js";
import { detectPrimaryLanguage } from "../language/detectLanguage.js";
import { chatStream } from "../engines/ollamaClient.js";
import { mapReduceStream } from "./mapReduce.js";
import { summarizeYoutube } from "./youtubeSummarize.js";

// How much of a discussion's post body to carry into each later chunk as
// context (see discussionPostExcerpt / the buildMap below).
const POST_CONTEXT_EXCERPT_CHARS = 800;

// Pulls the "Post:" body the discussion extractors emit (see
// content/extractors/reddit.js and hackernews.js) out of the extracted content,
// trimmed to a short excerpt. Empty for link posts / stories with no body.
export function discussionPostExcerpt(content) {
  const m = content.match(
    /\nPost:\n([\s\S]*?)\n\n(?:Comments \(|\(No comments)/,
  );
  if (!m) return "";
  const body = m[1].trim();
  return body.length > POST_CONTEXT_EXCERPT_CHARS
    ? `${body.slice(0, POST_CONTEXT_EXCERPT_CHARS).trim()}…`
    : body;
}

/**
 * Async-generator yielding summary tokens for the given text via Ollama.
 * `chunkTextFn`/`chatStreamFn` are injectable seams for tests; `onProgress`
 * is an optional UI hook (used by the WebLLM offscreen path to surface
 * "Summarizing part N of M..." during the otherwise-silent map phase).
 * It receives `{ stage: "map", index, total }` per chunk,
 * `{ stage: "reduce" }` before the final merge, and
 * `{ stage: "truncated", kept, total }` once if the input was longer than
 * the model's chunk fan-out budget (see getMaxChunks) and its tail dropped.
 */
export async function* summarizeText(
  { text, title, url, mode, model, host, signal, type, language },
  {
    chunkTextFn = chunkBySections,
    chatStreamFn = chatStream,
    onProgress,
    detectLanguageFn = detectPrimaryLanguage,
    translateFn,
    selectChunksFn,
  } = {},
) {
  // YouTube still honors `mode`, but always runs a single map+assemble pass
  // with timestamp links woven through. See youtubeSummarize.js's own
  // module comment for why that's a separate pipeline rather than another
  // branch here. (No selectChunksFn: a video's chunks are chronological, so
  // mapReduceStream's stratified sampling — even coverage across the runtime —
  // fits better than reordering by salience.)
  if (type === "youtube") {
    yield* summarizeYoutube(
      { text, title, url, mode, model, host, signal, language },
      { chunkTextFn, chatStreamFn, onProgress, detectLanguageFn, translateFn },
    );
    return;
  }

  // Threaded discussions (HN/Reddit) get a conversation-synthesis prompt that
  // reads the extractors' path notation and draws out viewpoints/disagreements,
  // instead of the article-condensing default. Everything else summarizes as an
  // article. `buildPrompt` keeps the same (title, url, content, mode, style)
  // shape either way.
  const isDiscussion = type === "hackernews" || type === "reddit";
  const buildPrompt = isDiscussion ? buildDiscussionPrompt : buildSummaryPrompt;

  // Carry the post itself into every later chunk of a discussion. When a big
  // thread splits across chunks, only the first chunk holds the "Post:" body;
  // later chunks would otherwise summarize comments blind to what the thread is
  // even about. Prepend a short post excerpt to those chunks — the idea
  // reddit-gpt-summarizer uses when it frames each comment group with the
  // (condensed) title + selftext. Extractive (first N chars), so no extra pass.
  const postExcerpt = isDiscussion ? discussionPostExcerpt(text) : "";
  const withPostContext = (chunk, i) =>
    i > 0 && postExcerpt
      ? `[Post context]\n${postExcerpt}\n\n[Comments in this part of the thread]\n${chunk}`
      : chunk;

  const scaledFor = (partials) =>
    mode === "bullets" ? buildScaledBulletsStyle(partials.length) : undefined;

  // The clean/chunk/cap + map/reduce + target-language machinery lives in
  // mapReduceStream (including chunk selection when a doc is too long — see
  // selectChunksFn). This only supplies the per-stage prompts.
  //
  // A single chunk always summarizes directly in the requested mode (highest
  // fidelity — no intermediate compression). Multi-chunk splits by content:
  //   - Discussions keep the conversation-synthesis prompt for map and reduce,
  //     with the post carried into later chunks (see withPostContext).
  //   - Articles use extract-then-abstract: each chunk's map pass EXTRACTS dense
  //     grounded notes (buildExtractNotesPrompt), then one reduce pass composes
  //     the mode-formatted summary from all the notes (buildSynthesisPrompt).
  //     Pulling atomic facts first and composing once preserves more specifics
  //     than re-summarizing already-compressed per-chunk prose.
  yield* mapReduceStream(
    { text, model, host, signal, language },
    {
      chunkTextFn,
      chatStreamFn,
      onProgress,
      detectLanguageFn,
      translateFn,
      selectChunksFn,
    },
    {
      buildSingle: (chunk) => buildPrompt(title, url, chunk, mode),
      buildMap: isDiscussion
        ? (chunk, i) => buildPrompt(title, url, withPostContext(chunk, i), mode)
        : (chunk, i, total) => buildExtractNotesPrompt(title, chunk, i, total),
      buildReduce: isDiscussion
        ? (partials) =>
            buildPrompt(
              title,
              url,
              partials.join("\n"),
              mode,
              scaledFor(partials),
            )
        : (partials) =>
            buildSynthesisPrompt(
              title,
              url,
              partials.join("\n"),
              mode,
              scaledFor(partials),
            ),
    },
  );
}
