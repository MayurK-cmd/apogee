// Client-side prompt templates, ported from apogee-backend/src/prompts/*.txt and apogee-backend/src/services/promptService.js.
// Used by the WebLLM offscreen engine so it can generate prompts without a backend server.

import { SUMMARY_LANGUAGES } from "../constants.js";
import { formatSecondsAsTimestamp } from "./timestamps.js";

// code -> English language name (see SUMMARY_LANGUAGES). "auto" (and any
// unknown code) maps to null, meaning "no target language"; callers then skip
// the system directive / translation and leave output in the source language.
const LANGUAGE_NAMES = new Map(SUMMARY_LANGUAGES.map((l) => [l.code, l.name]));

// Resolves a language code to its English name, or null for "auto"/unknown.
// null means "no translation"; callers skip the translate pass entirely.
export function resolveLanguageName(language) {
  return LANGUAGE_NAMES.get(language) || null;
}

// System-role directive forcing the target language on the FIRST summary pass
// (see streamFinal in lib/ollamaSummarize.js). A system message is weighted far
// more heavily by instruct models than the inline user-text directive that
// small models ignored, so this usually yields the target language in a single
// pass; output is verified and falls back to buildTranslatePrompt if it slips.
// Returns null for "auto"/unknown.
export function buildLanguageSystemPrompt(language) {
  const name = resolveLanguageName(language);
  if (!name) return null;
  return (
    `You are Apogee. Write your ENTIRE response in ${name}. ` +
    `Even when the user's text is in another language, always respond only in ${name}, ` +
    `never in any other language.`
  );
}

// Focused "translate this finished text" prompt, run as a SEPARATE pass after
// summarization (see summarizeText / summarizeYoutube). The small in-browser
// models (0.5B-1.7B) reliably ignore an inline "write your summary in X"
// directive across a long summarization task, but handle a short, standalone
// "translate this to X" task well, the same explicit-translation-step
// approach Kagi's summarizer uses. Formatting/link/timestamp preservation
// rules keep bullet structure and YouTube [MM:SS](url) deep-links intact.
export function buildTranslatePrompt(text, language) {
  const name = resolveLanguageName(language) || "the requested language";
  return [
    `You are a translation engine. Translate the text below into ${name}.`,
    "",
    "Rules:",
    `- Output ONLY the ${name} translation — no preamble, notes, or explanation.`,
    "- Preserve the formatting exactly: keep every line break, bullet marker, and heading.",
    "- Keep Markdown links intact: translate the visible link text but NEVER change the URL inside the parentheses.",
    "- Leave numbers, timestamps (e.g. [4:12]), proper names, and code unchanged.",
    `- If a passage is already in ${name}, keep it unchanged.`,
    "",
    "TEXT TO TRANSLATE:",
    text,
  ].join("\n");
}

function bulletsStyle(min, max) {
  return [
    "Return only the final answer.",
    "",
    "Rules:",
    `- Output ${min}-${max} bullet points.`,
    "- CRITICAL LENGTH RULE: every single bullet MUST be 2-3 full sentences (2 minimum). Write the point in the first sentence, then use one or two more sentences to explain it, give the reason, or add the key supporting detail (a number, name, cause, or consequence). A one-sentence bullet or a short fragment is WRONG and must not appear.",
    "- Each bullet must be on its own line.",
    "- Do not write any introduction.",
    "- Do not write any heading.",
    "- Do not write any conclusion.",
    "- Do not explain what you are doing.",
    '- Do not prefix the output with phrases like "Here is the summary", "Summary:", or similar.',
    "- Output only the bullet points.",
    "",
    "Here is ONE example bullet showing the REQUIRED length and depth (its topic is unrelated — copy only its length and level of detail, never its content):",
    "- Researchers found that the coating cuts heat loss by nearly 40% compared with standard glass. It works by reflecting infrared light back into the room while still letting visible light through, so windows stay clear. The team estimates a typical household could save around $300 a year on heating once the coating is widely available.",
    "",
    "Notice that the example bullet is three full sentences — every bullet you write must have that much substance.",
  ].join("\n");
}

export const SUMMARY_STYLES = {
  bullets: bulletsStyle(5, 8),

  sentences: [
    "Return only the final answer.",
    "",
    "Rules:",
    "- Output exactly 10-15 concise sentences.",
    "- Put each sentence on a separate line.",
    "- Do not use bullets.",
    "- Do not use numbering.",
    "- Do not write a paragraph.",
    "- Do not write any introduction.",
    "- Do not write any heading.",
    "- Do not write any conclusion.",
    '- Do not prefix the response with phrases like "Here is the summary", "Summary:", "Below is a summary", or similar.',
    "- Output only the sentences.",
  ].join("\n"),

  paragraphs: [
    "Return only the final answer.",
    "",
    "Rules:",
    "- Output one concise paragraph containing 10-15 sentences.",
    "- Do not use bullets.",
    "- Do not use numbering.",
    "- Do not add a heading.",
    "- Do not write an introduction.",
    "- Do not write a conclusion.",
    '- Do not prefix the response with phrases like "Here is the summary", "Summary:", or similar.',
    "- Output only the paragraph.",
  ].join("\n"),
};

// Bullets' reduce/synthesis pass (see ollamaSummarize.js's summarizeText)
// needs a bullet-count target that scales with how many chunks got merged,
// not the fixed 5-8 SUMMARY_STYLES.bullets uses for a single pass: merging a
// long, many-chunk document down to always-5-8-bullets loses most of its
// content, the exact regression a prior fix avoided by not merging bullets at
// all (see offscreen.js's runSummarize comment). Grows by BULLET_COUNT_STEP
// per chunk beyond the first, capped at MAX_BULLET_COUNT. Counts are lower
// than before because each bullet is now a fuller 2-3 sentence point (see
// bulletsStyle), so a shorter list still carries a comprehensive summary
// instead of an overwhelming wall.
const BULLET_COUNT_STEP = 2;
const MAX_BULLET_COUNT = 14;

export function buildScaledBulletsStyle(chunkCount) {
  const min = Math.min(
    5 + BULLET_COUNT_STEP * (chunkCount - 1),
    MAX_BULLET_COUNT - 3,
  );
  const max = Math.min(
    8 + BULLET_COUNT_STEP * (chunkCount - 1),
    MAX_BULLET_COUNT,
  );
  return bulletsStyle(min, max);
}

export function buildSummaryPrompt(title, url, content, mode, styleOverride) {
  const style = styleOverride || SUMMARY_STYLES[mode] || SUMMARY_STYLES.bullets;
  return [
    "You are Apogee, a strict factual browser summarizer.",
    "",
    "Your job is to summarize ONLY the substantive information in the provided text.",
    "Summarize as a neutral third party. Do NOT advertise, promote, or sell anything.",
    "",
    "IMPORTANT RULES:",
    "- Do NOT invent information",
    "- Do NOT create fake titles",
    "- Do NOT create fake authors",
    "- Do NOT speculate",
    "- Do NOT add opinions",
    "- Stay grounded in the provided text",
    "- Summarize the actual subject matter (what happened, the key facts, findings, or arguments), NOT how the content markets itself",
    "- IGNORE and do NOT repeat promotional or non-substantive material: sponsor/ad reads, calls to action (subscribe, like, follow, comment), channel or product plugs, merchandise, teaser/hype taglines, availability/language notes, and behind-the-scenes/production notes",
    "- Do NOT copy marketing phrasing from the title or description; restate the substance plainly",
    "- If the text contains a transcript, base the summary on the transcript and treat any title/description as secondary context only",
    "- If, after removing promotional material, there is not enough substance to summarize, say so plainly instead of padding with marketing copy",
    "",
    "ARTICLE TITLE:",
    title,
    "",
    "ARTICLE URL:",
    url,
    "",
    "SUMMARY STYLE:",
    style,
    "",
    "The SUMMARY STYLE is mandatory. Follow it exactly.",
    "",
    "ARTICLE CONTENT:",
    content,
  ].join("\n");
}

// Map stage of a multi-chunk article summary: extract the substantive points
// from ONE part of a long document as dense, grounded notes for a later
// synthesis pass (buildSynthesisPrompt). Extract-then-abstract — pull the
// atomic facts first, then compose the summary from all of them at once —
// keeps far more specifics than summarizing each part into prose and then
// re-summarizing that prose (which compounds compression loss and drops
// details). Chunk boundaries are plain slices, so this only ever sees PART of
// the document: it must extract what THIS part says, not summarize "the whole
// document" or write a conclusion, or a multi-chunk result reads like several
// disjoint mini-summaries.
export function buildExtractNotesPrompt(title, chunk, chunkIndex, chunkTotal) {
  return [
    "You are Apogee, extracting the key information from one part of a document.",
    "",
    `This is PART ${chunkIndex + 1} OF ${chunkTotal} — only a fragment. Extract what THIS part states; do not summarize the whole document or add a conclusion.`,
    "",
    "Extract the substantive points as a plain list:",
    '- One point per line, each starting with "- ".',
    "- Capture facts, findings, arguments, events, names, and numbers — keep concrete specifics, do not generalize them away.",
    "- Stay strictly grounded in this part's text; do NOT invent or infer beyond it.",
    "- IGNORE promotional or non-substantive material (ads, sponsor reads, calls to action, navigation, boilerplate).",
    "- Output only the list: no preamble, no heading, no conclusion.",
    "",
    "DOCUMENT TITLE:",
    title,
    "",
    `PART ${chunkIndex + 1} OF ${chunkTotal}:`,
    chunk,
  ].join("\n");
}

// Reduce stage: compose the final summary, in the requested style, from the
// notes buildExtractNotesPrompt pulled out of every part. Chain-of-density in
// spirit — cover all the important points, stay concrete and information-dense,
// and merge duplicates — rather than a loose re-summary of already-compressed
// text.
export function buildSynthesisPrompt(title, url, notes, mode, styleOverride) {
  const style = styleOverride || SUMMARY_STYLES[mode] || SUMMARY_STYLES.bullets;
  return [
    "You are Apogee, a strict factual browser summarizer.",
    "",
    "Below are notes extracted from across a long document (assembled from its parts). Compose ONE coherent summary of the whole document from them.",
    "",
    "IMPORTANT RULES:",
    "- Base the summary ONLY on the notes; do NOT invent, speculate, or add opinions.",
    "- Cover the important points from across ALL the notes, not just the first few.",
    "- Merge duplicates: if a point recurs across notes, state it once.",
    "- Be specific and information-dense: prefer concrete facts, numbers, and names over vague statements, and cut filler.",
    "- Summarize as a neutral third party; do NOT advertise or promote.",
    "",
    "DOCUMENT TITLE:",
    title,
    "",
    "DOCUMENT URL:",
    url,
    "",
    "SUMMARY STYLE:",
    style,
    "",
    "The SUMMARY STYLE is mandatory. Follow it exactly.",
    "",
    "EXTRACTED NOTES:",
    notes,
  ].join("\n");
}

// Summary prompt for threaded discussions (Hacker News, Reddit). Same
// map/reduce shape and mandatory SUMMARY STYLE as buildSummaryPrompt, but the
// job is synthesizing a conversation, not condensing an article: surface the
// themes, the range of opinion, and where people actually disagree, rather than
// flattening a many-voice thread into one neutral article summary. The thread
// arrives in the path notation the discussion extractors emit (see
// content/extractors/hackernews.js) — this explains that notation to the model
// so it can weight and, where useful, attribute what was said.
export function buildDiscussionPrompt(
  title,
  url,
  content,
  mode,
  styleOverride,
) {
  const style = styleOverride || SUMMARY_STYLES[mode] || SUMMARY_STYLES.bullets;
  return [
    "You are Apogee, summarizing an online discussion thread as a neutral observer.",
    "",
    "The thread is provided as a hierarchy of comments. Each line is one comment:",
    "  [1], [1.1], [1.1.1] … is its path in the reply tree (so [1.1] is a reply to [1]).",
    "  <replies: N> is how many direct replies it drew; more replies = a more significant point of discussion.",
    "  (score: N) is the comment's net upvotes where available; higher = the community endorsed it more.",
    "  {downvotes: N} marks a comment the community pushed back on; treat it with skepticism.",
    "  Then the username and the comment text.",
    "",
    "Your job:",
    "- Identify the main themes and arguments the discussion actually centered on.",
    "- Represent the range of viewpoints, especially where commenters disagree, and note any rough consensus.",
    "- Surface genuinely insightful or high-engagement sub-threads over one-off asides.",
    "- Stay neutral: report what people argued, do not take a side or add your own opinion.",
    "",
    "IMPORTANT RULES:",
    "- Do NOT invent comments, users, or positions that are not in the thread",
    "- Do NOT speculate beyond what was written",
    "- Base the summary on the comments, treating the title/post as context",
    "- You MAY attribute a notable point to its username when it aids clarity, but do not force it",
    "- IGNORE spam, flame, and off-topic noise; weight heavily-downvoted comments lightly",
    "- If there is little real discussion, say so plainly instead of padding",
    "",
    "DISCUSSION TITLE:",
    title,
    "",
    "DISCUSSION URL:",
    url,
    "",
    "SUMMARY STYLE:",
    style,
    "",
    "The SUMMARY STYLE is mandatory. Follow it exactly.",
    "",
    "DISCUSSION THREAD:",
    content,
  ].join("\n");
}

// Condenses one chunk of a YouTube transcript (see lib/youtubeSummarize.js's
// map stage) into timestamped notes for a later assembly pass. Chunk
// boundaries are plain character-count slices (lib/chunk.js), so this only
// ever sees part of the video, so it must not try to summarize "the video",
// only extract this part's content, or a multi-chunk summary reads like
// several disjointed mini-summaries stitched together.
export function buildYoutubeMapPrompt(title, chunk, chunkIndex, chunkTotal) {
  return [
    "You are Apogee, condensing one part of a YouTube video's transcript into notes for a later assembly step. Another pass will turn your notes (from every part) into the final summary - do not try to summarize the whole video here.",
    "",
    `This is part ${chunkIndex + 1} of ${chunkTotal} of the transcript.`,
    "The transcript below has inline [MM:SS] timestamp markers roughly every 20 seconds.",
    "",
    "Rules:",
    "- Extract only the substantive points made in THIS PART: facts, claims, examples, numbers, names, conclusions.",
    "- IGNORE sponsor/ad reads, calls to action, subscribe/like/follow requests, channel or merch plugs, and other promotional filler.",
    "- Write 3-8 concise bullet points.",
    "- Prefix each bullet with the single closest [MM:SS] marker from the transcript above, copied EXACTLY as written. Never invent, adjust, or estimate a timestamp.",
    "- Do not add any heading, introduction, or conclusion. Output only the bullets.",
    "",
    "VIDEO TITLE:",
    title,
    "",
    "TRANSCRIPT PART:",
    chunk,
  ].join("\n");
}

// Turns the concatenated notes from every buildYoutubeMapPrompt call (or, for
// a video short enough to need only one chunk, the raw timestamped
// transcript directly) into the final summary. Shares SUMMARY_STYLES with
// buildSummaryPrompt so a YouTube video respects the same bullets/
// sentences/paragraphs choice as any other page, layered with timestamp-link
// rules on top rather than a separate always-on structured-brief format.
// Builds the prefix a "&t=SECONDSs" style deep-link hangs off. A plain
// `${url}&t=` assumed a `watch?v=` URL with an existing query string; a bare
// /shorts/<id> URL has no `?`, so that produced a broken `/shorts/abc&t=42s`.
// Normalize to a canonical watch URL when the video id is recognizable
// (shorts, youtu.be, watch), otherwise fall back to the correct separator
// (?t= vs &t=) for whatever URL we were handed.
function youtubeTimestampBase(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    let videoId = null;
    if (host === "youtu.be") {
      videoId = u.pathname.slice(1).split("/")[0];
    } else if (u.pathname.startsWith("/shorts/")) {
      videoId = u.pathname.split("/")[2];
    } else if (u.pathname === "/watch") {
      videoId = u.searchParams.get("v");
    }
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}&t=`;
    return url + (u.search ? "&t=" : "?t=");
  } catch {
    return url + (url.includes("?") ? "&t=" : "?t=");
  }
}

export function buildYoutubeAssemblyPrompt(
  title,
  url,
  notes,
  lastAvailableSeconds,
  mode,
) {
  const style = SUMMARY_STYLES[mode] || SUMMARY_STYLES.bullets;
  const lastTimestamp = formatSecondsAsTimestamp(lastAvailableSeconds);
  const tsBase = youtubeTimestampBase(url);
  return [
    "You are Apogee, an expert YouTube summarizer.",
    "Turn the timestamped notes below into a summary of the video, while still making it easy to jump to any part of the original video.",
    "",
    "Core rules:",
    "- Base every claim strictly on the provided notes. Do not invent facts, quotes, names, or timestamps.",
    "- Every timestamp you use MUST be copied from the notes exactly, or omitted. Never invent, adjust, or estimate one.",
    `- Never use a timestamp later than ${lastAvailableSeconds} seconds (${lastTimestamp}), the last moment actually covered by the transcript.`,
    "- Omit anything promotional (sponsor reads, subscribe asks, merch, calls to action) that may have slipped into the notes.",
    "- Be neutral: summarize and explain, do not editorialize.",
    "",
    "Timestamp links (mandatory on every point):",
    `- Every point MUST start with its timestamp as a Markdown link back to that moment in the video: [MM:SS](${tsBase}SECONDSs), where SECONDS is the integer seconds copied from the notes (e.g. a [4:12] note becomes [4:12](${tsBase}252s)).`,
    '- Format each point exactly as: "[MM:SS](link): summary text" - the timestamp link, then a colon, then the point itself.',
    "- Never omit the timestamp from a point.",
    "",
    "SUMMARY STYLE:",
    style,
    "",
    "The SUMMARY STYLE above governs the overall structure (bullets/sentences/paragraph). Follow it exactly, but every point/sentence must still start with its timestamp per the mandatory rule above.",
    "",
    "VIDEO TITLE:",
    title,
    "",
    "TIMESTAMPED NOTES:",
    notes,
  ].join("\n");
}

// Chaptered-brief assembly (see lib/youtubeSummarize.js), the OpenBrief-style
// alternative to buildYoutubeAssemblyPrompt used when a video's description
// defines real chapter markers (parsed by lib/youtubeChapters.js). Instead of
// a flat bullets/sentences/paragraphs list, it produces an overview + one
// section per chapter + key takeaways. `chapters` is `[{ start, title }]`
// (seconds). Each chapter's section heading — its jump-link and label — is
// built here, deterministically, from the chapter's own start time, so the
// model never has to fabricate a section timestamp or link; it only buckets
// the notes' [MM:SS] points into the chapter ranges. `mode` is intentionally
// ignored: a chaptered brief has its own fixed shape, the same way YouTube
// already overrides some plain-page behavior.
export function buildYoutubeBriefPrompt(
  title,
  url,
  notes,
  chapters,
  lastAvailableSeconds,
) {
  const tsBase = youtubeTimestampBase(url);
  const lastTimestamp = formatSecondsAsTimestamp(lastAvailableSeconds);

  const chapterHeadings = chapters.map((c, i) => {
    const start = Math.floor(c.start);
    const end =
      i + 1 < chapters.length
        ? Math.floor(chapters[i + 1].start)
        : Math.floor(lastAvailableSeconds);
    const link = `[${formatSecondsAsTimestamp(start)}](${tsBase}${start}s)`;
    const range =
      end > start ? `covers ${start}s-${end}s` : `covers ${start}s onward`;
    return `### ${link} ${c.title}   (${range})`;
  });

  return [
    "You are Apogee, turning timestamped notes from a YouTube video into a structured brief that stays easy to navigate.",
    "",
    "Write the brief in Markdown with EXACTLY this structure:",
    '1. A "## Overview" heading, then 2-3 sentences on what the video is about.',
    "2. Then the chapter sections listed below, IN THE GIVEN ORDER, each starting with the provided heading line copied VERBATIM (do not change its link, timestamp, or title), followed by 2-3 bullet points summarizing that chapter. Each bullet must be a substantial point of 2-3 full sentences, not a one-line fragment.",
    '3. A final "**Key Takeaways**" line, then 3-4 bullets capturing the most important points of the whole video, each a full 2-3 sentence point.',
    "",
    "Core rules:",
    "- Base every point strictly on the notes. Do not invent facts, quotes, names, or timestamps.",
    "- Fill each chapter's bullets ONLY from notes whose [MM:SS] timestamp falls within that chapter's covered range.",
    '- If a chapter has no matching notes, give it a single bullet: a one-line description inferred from its title, or "- (not covered in detail)".',
    "- Use each chapter heading line EXACTLY as given below. Never alter, reorder, add, or drop a heading, and never invent a new timestamp or link.",
    `- Never reference a moment later than ${lastAvailableSeconds} seconds (${lastTimestamp}), the end of the available transcript.`,
    "- Omit anything promotional (sponsor reads, subscribe asks, merch, calls to action).",
    '- Be neutral: summarize and explain, do not editorialize. Do not add any preamble like "Here is the brief".',
    "",
    "CHAPTER HEADINGS (use each line verbatim as a section header, in this order):",
    chapterHeadings.join("\n"),
    "",
    "VIDEO TITLE:",
    title,
    "",
    "TIMESTAMPED NOTES:",
    notes,
  ].join("\n");
}

export function buildAnswerPrompt(title, url, content, question) {
  return [
    "You are Apogee, a factual browser assistant.",
    "",
    "Answer the user's question using only the article content below.",
    "Keep the answer concise.",
    "Maximum 3-4 lines.",
    "Do not use markdown.",
    "Do not use bullet points unless necessary.",
    "If the article does not contain enough information, say that clearly.",
    "",
    "Title:",
    title,
    "",
    "URL:",
    url,
    "",
    "Question:",
    question,
    "",
    "Article:",
    content,
  ].join("\n");
}

export function buildSuggestQuestionsPrompt(title, url, summary) {
  return [
    "You are Apogee, a concise browser assistant.",
    "",
    "Generate exactly two useful follow-up questions a reader may want to ask after",
    "reading this summary.",
    "",
    "Rules:",
    "- Return only the two questions.",
    "- Put each question on its own line.",
    "- Do not number the questions.",
    "- Do not use bullets.",
    "- Do not add headings or explanations.",
    "- Make the questions specific to the article, video, email, or PDF.",
    "",
    `Title: ${title}`,
    `URL: ${url}`,
    "",
    "Summary:",
    summary,
  ].join("\n");
}
