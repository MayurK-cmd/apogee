import { cleanText } from "./cleaner.js";
import { getMaxChunkChars, getMaxChunks } from "../engines/modelLimits.js";
import { streamInTargetLanguage } from "../language/languageOutput.js";

function stratifiedSample(chunks, k) {
  if (chunks.length <= k) return chunks;
  const step = chunks.length / k;
  const picked = [];
  for (let i = 0; i < k; i++) picked.push(chunks[Math.floor(i * step)]);
  return picked;
}

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

  const chat = (prompt, opts) => chatStreamFn(host, model, prompt, opts);
  const streamFinal = (finalPrompt) =>
    streamInTargetLanguage(chat, finalPrompt, language, {
      signal,
      detectLanguageFn,
      translateFn,
      onFallback: () => onProgress?.({ stage: "translate" }),
    });

  if (chunks.length <= 1) {
    if (signal?.aborted) return;
    yield* streamFinal(buildSingle(chunks[0] || ""));
    return;
  }

  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return;
    onProgress?.({ stage: "map", index: i, total: chunks.length });
    let partial = "";
    try {
      for await (const token of chatStreamFn(
        host,
        model,
        buildMap(chunks[i], i, chunks.length),
        { signal },
      )) {
        if (signal?.aborted) return;
        partial += token;
      }
      if (partial.trim()) {
        partials.push(partial.trim());
      }
    } catch (err) {
      if (signal?.aborted) return;
      // If OOM or resource limit hit on a chunk, keep partials collected so far
      const isOOM =
        /out of memory|oom|buffer allocation|gpubuffer|allocation failed|memory limit/i.test(
          err?.message || "",
        );
      if (isOOM && partials.length > 0) {
        onProgress?.({ stage: "oom_fallback", index: i });
        break;
      }
      throw err;
    }
  }

  if (signal?.aborted) return;
  if (partials.length === 0) return;
  onProgress?.({ stage: "reduce" });
  yield* streamFinal(buildReduce(partials));
}
