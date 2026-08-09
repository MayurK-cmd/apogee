export function cleanText(text) {
  let cleaned = text.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/[^\S\n]+/g, " ");
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return cleaned.trim();
}
