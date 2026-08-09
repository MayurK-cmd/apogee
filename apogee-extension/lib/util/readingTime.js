import { isVideoType } from "../constants.js";

const AVERAGE_READING_WPM = 225;

function countWords(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function formatMinutesSaved(savedMinutes) {
  if (savedMinutes < 0.5) return null;

  const savedSeconds = Math.round(savedMinutes * 60);
  if (savedSeconds < 60) {
    return `~${savedSeconds}s saved`;
  }
  return `~${Math.round(savedMinutes)} min saved`;
}

export function formatTimeSaved(originalText, summaryText) {
  return formatTimeSavedFromWordCount(countWords(originalText), summaryText);
}

export function formatTimeSavedFromWordCount(originalWords, summaryText) {
  const summaryWords = countWords(summaryText);
  const savedMinutes =
    ((originalWords || 0) - summaryWords) / AVERAGE_READING_WPM;
  return formatMinutesSaved(savedMinutes);
}

export function formatVideoTimeSaved(durationSeconds, summaryText) {
  const summaryWords = countWords(summaryText);
  const summaryMinutes = summaryWords / AVERAGE_READING_WPM;
  const savedMinutes = (durationSeconds || 0) / 60 - summaryMinutes;
  return formatMinutesSaved(savedMinutes);
}

export function timeSavedInputsFor({ type, durationSeconds, content } = {}) {
  if (isVideoType(type)) {
    return { kind: "video", durationSeconds: durationSeconds || 0 };
  }
  const originalWords = countWords(content);
  if (!originalWords) return null;
  return { kind: "text", originalWords };
}

export function formatTimeSavedFromInputs(inputs, summaryText) {
  if (!inputs) return null;
  return inputs.kind === "video"
    ? formatVideoTimeSaved(inputs.durationSeconds, summaryText)
    : formatTimeSavedFromWordCount(inputs.originalWords, summaryText);
}
