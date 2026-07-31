// Bilibili video extractor, the second video platform Apogee special-cases
// alongside YouTube (see content/extractors/youtube.js). Same shape: pull the
// video's metadata + a timestamped transcript so lib/summarize/youtubeSummarize.js
// can produce a summary with jump-to-moment deep links (Bilibili's are
// `?t=<seconds>`, see videoTimestampParts in lib/summarize/prompts.js). Returns
// `type: "bilibili"`, which isVideoType() routes down that same video pipeline.
//
// Helper names are bili-prefixed on purpose: these extractors are injected as
// plain (non-module) scripts sharing one global scope with youtube.js, so a
// bare `formatTimestamp` / `extractBalancedObject` would clobber YouTube's.

// Brace-matched `{...}` substring starting at openIndex, respecting string
// literals/escapes so a `}` inside a nested string doesn't end it early. Same
// approach youtube.js uses for ytInitialPlayerResponse.
function biliExtractBalancedObject(text, openIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return null;
}

// Bilibili embeds its page state as an inline `window.__INITIAL_STATE__={...}`
// assignment. Content scripts run in an isolated world, so the page's own
// global isn't reachable, but the raw <script> text is (shared DOM), same as
// YouTube's ytInitialPlayerResponse.
function getBiliInitialState() {
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    if (!text || !text.includes("__INITIAL_STATE__")) continue;
    const assign = text.match(/window\.__INITIAL_STATE__\s*=\s*/);
    if (!assign) continue;
    const openIndex = text.indexOf("{", assign.index + assign[0].length);
    if (openIndex === -1) continue;
    const json = biliExtractBalancedObject(text, openIndex);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
      // Malformed/partial script, keep scanning.
    }
  }
  return null;
}

// "MM:SS", or "H:MM:SS" past the hour, matching the inline markers threaded
// through the transcript below and what youtubeSummarize.js expects.
function biliFormatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// One [MM:SS] marker roughly every 20s, same cadence/rationale as YouTube's:
// fine enough to cite specific moments, coarse enough not to bloat the token
// count with one marker per (often very short) caption line.
const BILI_TIMESTAMP_MARKER_INTERVAL_SECONDS = 20;

// Turns timed subtitle segments ([{ start, text }]) into a flat transcript
// string with inline [MM:SS] markers the summarizer copies into jump links.
function buildBiliTranscript(segments) {
  if (!segments.length) return "";
  let lastMarked = -Infinity;
  const parts = [];
  for (const seg of segments) {
    if (seg.start - lastMarked >= BILI_TIMESTAMP_MARKER_INTERVAL_SECONDS) {
      parts.push(`[${biliFormatTimestamp(seg.start)}]`);
      lastMarked = seg.start;
    }
    parts.push(seg.text);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Light description cleanup: drop bare-URL lines and collapse blank runs.
// Bilibili descriptions are far less ad-dense than YouTube's, so this stays
// deliberately minimal rather than porting YouTube's promo-phrase heuristics.
function cleanBiliDescription(description) {
  if (!description) return "";
  const urlOnlyLine = /^\s*(https?:\/\/|www\.)\S+\s*$/i;
  return description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !urlOnlyLine.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Fetches the subtitle track via the service worker (MV3 CORS + auth-cookie
// reasons, see fetchBilibiliSubtitles in background/service-worker.js). Returns
// timed segments, or [] on any failure / context-invalidation.
async function fetchBiliSubtitles({ aid, bvid, cid }) {
  try {
    const resp = await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "bilibili-subtitles",
      payload: {
        aid,
        bvid,
        cid,
        preferredLang: navigator.language || "zh",
      },
    });
    return Array.isArray(resp?.segments) ? resp.segments : [];
  } catch {
    return [];
  }
}

// Only real video watch pages carry a usable __INITIAL_STATE__.videoData;
// anything else on bilibili.com (the homepage, a space/user page, a live room)
// returns null so content.js falls through to the generic Readability path.
async function extractBilibili() {
  const state = getBiliInitialState();
  const videoData = state?.videoData;
  if (!videoData || !videoData.title) return null;

  const title = videoData.title;
  const channel = videoData.owner?.name || "";
  const description = videoData.desc || videoData.dynamic || "";

  // A video can have multiple parts; the URL's ?p=N (1-based) picks the current
  // one. Match the subtitle fetch to that part's cid, falling back to the
  // top-level cid.
  const pages = Array.isArray(videoData.pages) ? videoData.pages : [];
  const partParam = Number(new URLSearchParams(location.search).get("p")) || 1;
  const currentPage = pages[partParam - 1] || pages[0] || null;
  const cid = currentPage?.cid || videoData.cid || "";

  const durationSeconds = currentPage?.duration || videoData.duration || 0;
  const duration = durationSeconds
    ? `${Math.round(durationSeconds / 60)} min`
    : "";

  const aid = videoData.aid || state?.aid || "";
  const bvid = videoData.bvid || state?.bvid || "";

  const segments = cid ? await fetchBiliSubtitles({ aid, bvid, cid }) : [];
  const transcript = buildBiliTranscript(segments);
  const lastAvailableSeconds = segments.length
    ? segments[segments.length - 1].start
    : 0;

  // With a transcript the description is just context, so cap it short (same as
  // the YouTube extractor).
  let cleanedDescription = cleanBiliDescription(description);
  if (transcript && cleanedDescription.length > 500) {
    cleanedDescription = `${cleanedDescription.slice(0, 500).trim()}…`;
  }

  let content = `Video Title:\n${title}\n`;
  if (channel) content += `\nUploader: ${channel}\n`;
  if (duration) content += `\nDuration: ${duration}\n`;
  if (cleanedDescription) content += `\nDescription:\n${cleanedDescription}\n`;
  content += transcript
    ? `\nLast transcript timestamp: ${biliFormatTimestamp(lastAvailableSeconds)} (${Math.floor(lastAvailableSeconds)}s)\n\nTranscript:\n${transcript}\n`
    : "\n(No subtitles/captions available for this video.)\n";

  return {
    type: "bilibili",
    title,
    url: location.href,
    content,
    // Raw seconds for popup.js's time-saved badge, same as YouTube.
    durationSeconds,
  };
}
