// Powers the "~4 min saved" badge shown next to a finished summary. Purely a
// local word-count estimate (average adult silent-reading speed), nothing
// here talks to a model or a server.
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
  const originalWords = countWords(originalText);
  const summaryWords = countWords(summaryText);
  const savedMinutes = (originalWords - summaryWords) / AVERAGE_READING_WPM;
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
