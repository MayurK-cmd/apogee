// Retrieval-augmented context selection for "Ask" (see buildAnswerPrompt
// callers in background/service-worker.js). Replaces the old blind
// head-of-document truncation with picking the chunks most relevant to the
// question, so a long article/PDF/transcript no longer silently loses
// everything past the first ~8000 characters.

import { chunkText } from "../summarize/chunk.js";
import { embedTexts as embedTextsDefault, dot } from "../engines/embeddings.js";
import { cyrb53 } from "../util/hash.js";

// Smaller than MAX_CHUNK_CHARS (used for summarization's map-reduce): finer
// granularity here means retrieval can zero in on the specific passage that
// answers the question instead of pulling in a whole 6000-char neighborhood.
const RETRIEVAL_CHUNK_CHARS = 1000;
const DEFAULT_MAX_CONTEXT_CHARS = 6000;
const DEFAULT_TOP_K = 8;

// findBestPassage's second-stage sentence refinement (see its use below).
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
const MIN_REFINE_SENTENCE_CHARS = 25;

// Caches built chunk embeddings per page so asking several follow-up
// questions about the same page only embeds the document once. Keyed by a
// hash of the content text itself (not the URL), since the same URL can
// legitimately carry different content across calls. A plain in-memory Map
// is fine: this module only ever runs inside the offscreen document (see
// callers in offscreen.js), which stays alive for OFFSCREEN_IDLE_MINUTES of
// inactivity rather than getting evicted like the service worker, so this is
// a perf cache bounded by MAX_CACHE_ENTRIES, not a correctness dependency.
const MAX_CACHE_ENTRIES = 5;
const indexCache = new Map();

async function getOrBuildIndex(content, embedTextsFn) {
  // Keyed by a hash of the content text itself (cyrb53, see lib/hash.js), not
  // the URL, since the same URL can legitimately carry different content
  // across calls.
  const key = cyrb53(content);
  const cached = indexCache.get(key);
  if (cached) return cached;

  const chunks = chunkText(content, RETRIEVAL_CHUNK_CHARS);
  const embeddings = await embedTextsFn(chunks);

  const index = { chunks, embeddings };
  indexCache.set(key, index);
  while (indexCache.size > MAX_CACHE_ENTRIES) {
    indexCache.delete(indexCache.keys().next().value);
  }
  return index;
}

/**
 * Selects up to `maxChunks` of `chunks` that best COVER a long document for
 * summarization: each representative of the whole (close to the document's
 * embedding centroid) yet diverse from the others, via greedy MMR. This
 * replaces blind head-truncation (keeping only the first N chunks), so a long
 * document's summary reflects all of it, middle and end included, not just
 * its opening. Returns the picks in original document order for a coherent
 * read; returns `chunks` unchanged when already within budget, or `null` if
 * embedding fails (the caller then falls back to a cheaper selection).
 *
 * Unlike findBestPassage/retrieveRelevantContent there's no query, the
 * document's own centroid stands in for "what this document is about", so
 * salient = typical-of-the-document, and MMR spreads the picks across its
 * distinct topics instead of clustering on the single densest one.
 */
export async function selectSalientChunks(
  chunks,
  maxChunks,
  { embedTextsFn = embedTextsDefault } = {},
) {
  if (!Array.isArray(chunks) || chunks.length <= maxChunks) return chunks;

  try {
    const embeddings = await embedTextsFn(chunks);
    const dim = embeddings[0].length;

    // Document centroid (mean of the L2-normalized chunk vectors). It isn't a
    // unit vector, but dot(chunk, centroid) still ranks representativeness
    // correctly since the scale factor is common to every chunk.
    const centroid = new Array(dim).fill(0);
    for (const e of embeddings) {
      for (let d = 0; d < dim; d++) centroid[d] += e[d];
    }
    for (let d = 0; d < dim; d++) centroid[d] /= embeddings.length;
    const salience = embeddings.map((e) => dot(e, centroid));

    // Greedy MMR: each pick maximizes representativeness minus its similarity
    // to the closest already-picked chunk, so picks stay on-topic but spread.
    const LAMBDA = 0.7;
    const chosen = [];
    const remaining = new Set(embeddings.map((_, i) => i));
    while (chosen.length < maxChunks && remaining.size) {
      let bestIndex = -1;
      let bestScore = -Infinity;
      for (const i of remaining) {
        const diversity = chosen.length
          ? Math.max(...chosen.map((j) => dot(embeddings[i], embeddings[j])))
          : 0;
        const score = LAMBDA * salience[i] - (1 - LAMBDA) * diversity;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      chosen.push(bestIndex);
      remaining.delete(bestIndex);
    }

    chosen.sort((a, b) => a - b);
    return chosen.map((i) => chunks[i]);
  } catch (err) {
    console.error("selectSalientChunks failed:", err);
    return null;
  }
}

/**
 * Returns a trimmed slice of `content`, made up of whichever chunks are most
 * relevant to `question` by embedding similarity, up to `maxContextChars`.
 * Content already within budget is returned unchanged (no embedding cost for
 * short pages/emails). Falls back to a plain prefix truncation if embedding
 * fails for any reason (e.g. the model couldn't be fetched on first use).
 */
export async function retrieveRelevantContent(
  {
    content,
    question,
    maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
    topK = DEFAULT_TOP_K,
  },
  { embedTextsFn = embedTextsDefault } = {},
) {
  const clean = (content || "").trim();
  if (clean.length <= maxContextChars) return clean;

  try {
    const index = await getOrBuildIndex(clean, embedTextsFn);
    if (index.chunks.length <= 1) return clean.slice(0, maxContextChars);

    const [questionEmbedding] = await embedTextsFn([question]);
    const scored = index.chunks.map((chunk, i) => ({
      chunk,
      index: i,
      score: dot(questionEmbedding, index.embeddings[i]),
    }));
    scored.sort((a, b) => b.score - a.score);

    const picked = [];
    let total = 0;
    for (const item of scored) {
      if (picked.length >= topK) break;
      if (total + item.chunk.length > maxContextChars && picked.length > 0) {
        continue;
      }
      picked.push(item);
      total += item.chunk.length;
    }
    // Restore original document order so the merged passages still read
    // coherently, rather than in similarity-rank order.
    picked.sort((a, b) => a.index - b.index);
    return picked.map((p) => p.chunk).join("\n\n");
  } catch (err) {
    console.error("RAG retrieval failed, falling back to truncation:", err);
    return clean.slice(0, maxContextChars) + "\n\n[...content truncated...]";
  }
}

// Re-ranks a chunk's own sentences by similarity to the query and returns the
// best one. The retrieval index is built at RETRIEVAL_CHUNK_CHARS (~1000)
// granularity, good for locating the right neighborhood, but far too coarse to
// highlight: handed a 1000-char chunk, the in-page matcher (content/highlight.js
// findMatchingRange) can rarely match the whole blob verbatim across the DOM's
// block boundaries and falls back to the chunk's LONGEST sentence, which need
// not be the one the clicked point is actually grounded in. Returning the
// query-relevant sentence instead makes the highlight land precisely, and a lone
// sentence (living within one block) also matches the live DOM far more reliably
// than a multi-paragraph chunk. Returns null when the chunk has nothing worth
// refining to (no punctuation, all-short fragments), leaving the caller on the
// full chunk.
async function refineToBestSentence(chunk, queryEmbedding, embedTextsFn) {
  const sentences = chunk
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_REFINE_SENTENCE_CHARS);
  if (sentences.length <= 1) return null;

  const embeddings = await embedTextsFn(sentences);
  let best = null;
  for (let i = 0; i < sentences.length; i++) {
    const score = dot(queryEmbedding, embeddings[i]);
    if (!best || score > best.score) best = { text: sentences[i], score };
  }
  return best?.text ?? null;
}

/**
 * Finds the single passage most similar to `query` (e.g. a clicked summary
 * bullet), for "click a bullet, highlight the matching passage in the page"
 * (see content/highlight.js and the "find-passage" action in offscreen.js).
 * Unlike retrieveRelevantContent, which merges several chunks into one
 * prompt-sized blob for an LLM, this returns exactly one passage plus a
 * similarity score: the caller needs a single contiguous span of *verbatim page
 * text* to search for and highlight in the live DOM, and needs the score to
 * decide whether the match is confident enough to act on at all (a top-1 match
 * always returns something, even for a bullet that's a cross-page synthesis with
 * no single matching passage).
 *
 * Two stages: pick the most-similar ~1000-char chunk (robust localization),
 * then refine to the single most-similar sentence within it (precise, reliably
 * locatable highlight, see refineToBestSentence). The returned `score` is the
 * coarse chunk score, which is more stable than a short sentence's own score,
 * so the caller's confidence gate behaves consistently.
 *
 * Shares the same content-hash-keyed index (and RETRIEVAL_CHUNK_CHARS
 * granularity) as retrieveRelevantContent, so asking a question and then
 * clicking bullets on the same page only embeds the document once.
 *
 * Returns null if `content`/`query` is empty or embedding fails for any
 * reason; there's no truncation fallback the way retrieveRelevantContent
 * has, a null result here just means "don't highlight anything."
 */
export async function findBestPassage(
  { content, query },
  { embedTextsFn = embedTextsDefault } = {},
) {
  const clean = (content || "").trim();
  if (!clean || !query) return null;

  try {
    const index = await getOrBuildIndex(clean, embedTextsFn);
    if (index.chunks.length === 0) return null;

    const [queryEmbedding] = await embedTextsFn([query]);
    let best = null;
    for (let i = 0; i < index.chunks.length; i++) {
      const score = dot(queryEmbedding, index.embeddings[i]);
      if (!best || score > best.score) {
        best = { chunk: index.chunks[i], score };
      }
    }

    // Refine the coarse chunk down to its most query-relevant sentence for a
    // precise highlight; a refinement failure just keeps the chunk.
    let passage = best.chunk;
    try {
      const sentence = await refineToBestSentence(
        best.chunk,
        queryEmbedding,
        embedTextsFn,
      );
      if (sentence) passage = sentence;
    } catch (err) {
      console.error("findBestPassage sentence refinement failed:", err);
    }
    return { chunk: passage, score: best.score };
  } catch (err) {
    console.error("findBestPassage failed:", err);
    return null;
  }
}
