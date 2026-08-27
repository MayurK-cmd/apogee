export const MAX_CHUNK_CHARS = 6000;

const MAX_SINGLE_PROMPT_CHARS = 8000;

export function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const clean = (text || "").trim();
  if (clean.length <= maxChars) {
    return clean ? [clean] : [];
  }

  const chunks = [];
  let remaining = clean;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    let splitAt = window.lastIndexOf("\n\n");
    if (splitAt < maxChars * 0.5) splitAt = window.lastIndexOf(". ");
    if (splitAt < maxChars * 0.5) splitAt = window.lastIndexOf(" ");
    if (splitAt <= 0) splitAt = maxChars;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function truncateForPrompt(text, maxChars = MAX_SINGLE_PROMPT_CHARS) {
  const clean = (text || "").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trim() + "\n\n[...content truncated...]";
}

export function chunkTextOverview(
  text,
  maxChars = MAX_CHUNK_CHARS,
  maxChunks = 3,
) {
  const chunks = chunkText(text, maxChars);
  if (chunks.length <= maxChunks) return chunks;

  const selected = [];
  selected.push(chunks[0]);
  const innerCount = maxChunks - 2;
  if (innerCount > 0) {
    const step = (chunks.length - 2) / (innerCount + 1);
    for (let i = 1; i <= innerCount; i++) {
      const index = Math.floor(i * step);
      if (index > 0 && index < chunks.length - 1) {
        selected.push(chunks[index]);
      }
    }
  }
  if (chunks.length > 1) {
    selected.push(chunks[chunks.length - 1]);
  }
  return selected;
}
