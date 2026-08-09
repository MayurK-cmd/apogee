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
    for await (const token of chatStreamFn(
      host,
      model,
      buildMap(chunks[i], i, chunks.length),
      { signal },
    )) {
      partial += token;
    }
    partials.push(partial.trim());
  }

  if (signal?.aborted) return;
  onProgress?.({ stage: "reduce" });
  yield* streamFinal(buildReduce(partials));
}
