// Client-side prompt templates, ported from apogee-backend/src/prompts/*.txt and apogee-backend/src/services/promptService.js.
// Used by the WebLLM offscreen engine so it can generate prompts without a backend server.

export const SUMMARY_STYLES = {
  bullets: [
    "Return only the final answer.",
    "",
    "Rules:",
    "- Output 8-14 concise bullet points.",
    "- Each bullet must be on its own line.",
    "- Do not write any introduction.",
    "- Do not write any heading.",
    "- Do not write any conclusion.",
    "- Do not explain what you are doing.",
    '- Do not prefix the output with phrases like "Here is the summary", "Summary:", or similar.',
    "- Output only the bullet points.",
  ].join("\n"),

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

export function buildSummaryPrompt(title, url, content, mode) {
  const style = SUMMARY_STYLES[mode] || SUMMARY_STYLES.bullets;
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
export function buildYoutubeAssemblyPrompt(
  title,
  url,
  notes,
  lastAvailableSeconds,
  mode,
) {
  const style = SUMMARY_STYLES[mode] || SUMMARY_STYLES.bullets;
  const lastTimestamp = formatSecondsAsTimestamp(lastAvailableSeconds);
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
    `- Every point MUST start with its timestamp as a Markdown link back to that moment in the video: [MM:SS](${url}&t=SECONDSs), where SECONDS is the integer seconds copied from the notes (e.g. a [4:12] note becomes [4:12](${url}&t=252s)).`,
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

function formatSecondsAsTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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
