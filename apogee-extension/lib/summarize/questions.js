const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s*/;

function stripListMarkers(line) {
  let cleaned = line.trim();
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(LIST_MARKER, "").trim();
  } while (cleaned !== previous);
  return cleaned;
}

export function parseSuggestedQuestions(text) {
  const withoutThinking = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "");

  return withoutThinking
    .split("\n")
    .map((line) => stripListMarkers(line))
    .filter((line) => line.length > 0 && line.endsWith("?"))
    .slice(0, 2);
}
