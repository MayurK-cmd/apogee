// Powers the "~4 min saved" badge shown next to a finished summary. Purely a
// local word-count estimate (average adult silent-reading speed), nothing
// here talks to a model or a server.
import { isVideoType } from "../constants.js";

const AVERAGE_READING_WPM = 225;

function countWords(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Shared by formatTimeSaved and formatVideoTimeSaved: turns a raw "minutes
// saved" figure into the badge's label, or null when there isn't enough of a
// gap to be worth bragging about, so callers can hide the badge entirely
// rather than show "~0 min saved".
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

// Same estimate as formatTimeSaved, but starting from a precomputed original
// word count rather than the original text. Used when the summary is restored
// from cache on popup reopen and the original page text is no longer in memory:
// the word count is persisted (see timeSavedInputsFor) so the badge can be
// recomputed against the restored summary and shown again, matching what was on
// screen before the popup closed.
export function formatTimeSavedFromWordCount(originalWords, summaryText) {
  const summaryWords = countWords(summaryText);
  const savedMinutes =
    ((originalWords || 0) - summaryWords) / AVERAGE_READING_WPM;
  return formatMinutesSaved(savedMinutes);
}

// YouTube variant: a transcript's word count doesn't track the video's
// actual runtime (spoken word rate vs. silent reading speed differ, and
// sponsor-stripped/partial transcripts undercount further), so "time saved"
// for a video is its real runtime minus the time to read the summary,
// rather than formatTimeSaved's read-the-original-text estimate.
export function formatVideoTimeSaved(durationSeconds, summaryText) {
  const summaryWords = countWords(summaryText);
  const summaryMinutes = summaryWords / AVERAGE_READING_WPM;
  const savedMinutes = (durationSeconds || 0) / 60 - summaryMinutes;
  return formatMinutesSaved(savedMinutes);
}

// The minimal, page-side inputs the badge needs, distilled so they can be
// persisted in the tab's view state and used to recompute the badge after the
// summary is restored from cache on popup reopen (when the full page data is
// gone). Videos measure against runtime (durationSeconds); everything else
// against the original text's word count. `content` is the resolved text used
// for the summary (for a PDF, its extracted body — not the empty pre-extract
// value). Returns null when there's nothing measurable.
export function timeSavedInputsFor({ type, durationSeconds, content } = {}) {
  if (isVideoType(type)) {
    return { kind: "video", durationSeconds: durationSeconds || 0 };
  }
  const originalWords = countWords(content);
  if (!originalWords) return null;
  return { kind: "text", originalWords };
}

// Recomputes the badge label from persisted timeSavedInputsFor() output against
// a (restored) summary. Mirror of the live updateTimeSavedBadge path in
// popup.js, but working from the persisted inputs instead of live page data.
export function formatTimeSavedFromInputs(inputs, summaryText) {
  if (!inputs) return null;
  return inputs.kind === "video"
    ? formatVideoTimeSaved(inputs.durationSeconds, summaryText)
    : formatTimeSavedFromWordCount(inputs.originalWords, summaryText);
}
