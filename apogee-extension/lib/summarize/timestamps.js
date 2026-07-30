// YouTube timestamp conversions (seconds ↔ "[H:]MM:SS"), shared by the pieces
// of the YouTube summarize flow that used to each carry their own copy:
// prompts.js (formatting chapter headings / jump links), youtubeChapters.js
// (parsing the description's chapter markers), and youtubeSummarize.js (finding
// the last transcript timestamp). The extractor (content/extractors/youtube.js)
// still mirrors these inline — content scripts are plain injected scripts and
// can't import ES modules — so keep that copy in sync with these.

// "0:45" -> 45, "3:12" -> 192, "1:02:03" -> 3723. Accepts "MM:SS" or "H:MM:SS".
export function timestampToSeconds(ts) {
  return ts.split(":").reduce((acc, n) => acc * 60 + Number(n), 0);
}

// 45 -> "0:45", 3723 -> "1:02:03". Minutes are zero-padded only past the hour,
// matching the [MM:SS] / [H:MM:SS] markers used throughout the YouTube flow.
export function formatSecondsAsTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
