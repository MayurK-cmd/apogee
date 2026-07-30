// Returns the `{...}` substring starting at openIndex, brace-matched while
// respecting string literals/escapes. A `/\{.*?\}/` regex can't do this, it
// stops at the first `}` inside the nested object.
function extractBalancedObject(text, openIndex) {
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

// Pulls the inline `ytInitialPlayerResponse = {...}` blob YouTube embeds in
// a <script> tag on page load. Content scripts run in an isolated JS world,
// so the page's own `window.ytInitialPlayerResponse` global isn't reachable
// directly, but the raw script text is, since the DOM is shared.
function getPlayerResponse() {
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    if (!text || !text.includes("ytInitialPlayerResponse")) continue;
    const assign = text.match(/ytInitialPlayerResponse\s*=\s*/);
    if (!assign) continue;
    const openIndex = text.indexOf("{", assign.index + assign[0].length);
    if (openIndex === -1) continue;
    const json = extractBalancedObject(text, openIndex);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
      // Malformed/unexpected script content, keep looking.
    }
  }
  return null;
}

// Caption text comes back XML-entity-encoded (&amp;, &#39;, ...). A
// detached <textarea> decodes entities without ever interpreting markup
// (textarea content is parsed as rawtext, not HTML), so this is safe even
// though the source is untrusted page content.
function decodeHtmlEntities(text) {
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

// Caption tracks are served from youtube.com / *.youtube.com and
// *.googlevideo.com. Accept only those hosts (over https) via exact suffix
// matching, not a substring test, which "youtube.com.attacker.com" passes.
function isAllowedCaptionUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  // Caption tracks are only ever served from these two, a broader
  // "*.google.com" suffix would also accept e.g. an authenticated
  // mail.google.com URL smuggled in through a crafted ytInitialPlayerResponse.
  const allowedSuffixes = [".youtube.com", ".googlevideo.com"];
  return (
    host === "youtube.com" ||
    allowedSuffixes.some((suffix) => host.endsWith(suffix))
  );
}

// Builds a caption URL for a format, replacing any existing `fmt` param.
function captionUrlWithFormat(baseUrl, fmt) {
  try {
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("fmt", fmt);
    return url.toString();
  } catch {
    return null;
  }
}

// Returns timed transcript segments (`[{ start, text }]`), or `[]` if the
// video has no usable captions.
async function fetchTranscript(playerResponse) {
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) return [];

  // Prefer the viewer's own language above all else: a human-written track in
  // it, then even its auto-generated (kind "asr") track, before falling back
  // to a human-written track in some OTHER language, then whatever's first.
  // Trying "any human track" before the viewer-language asr used to pull a
  // foreign human track (e.g. the original French captions on a video an
  // English viewer is watching) over the English auto-captions, yielding a
  // wrong-language transcript and a wasteful translate pass.
  const preferredLang = (navigator.language || "en").split("-")[0];
  const track =
    tracks.find((t) => t.languageCode === preferredLang && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === preferredLang) ||
    tracks.find((t) => t.kind !== "asr") ||
    tracks[0];

  if (!track.baseUrl) return [];

  // The timedtext endpoint increasingly returns an empty 200 body for some
  // formats when fetched outside the player, so probe json3 then legacy XML.
  for (const fmt of ["json3", "srv3", ""]) {
    const target = fmt
      ? captionUrlWithFormat(track.baseUrl, fmt)
      : track.baseUrl;
    if (!target || !isAllowedCaptionUrl(target)) continue;
    try {
      const res = await fetch(target);
      if (!res.ok) continue;
      const raw = await res.text();
      if (!raw.trim()) continue;
      const segments = parseTranscript(raw);
      if (segments.length) return segments;
    } catch {
      // Try the next format.
    }
  }

  return [];
}

// True when timestamp `t` (seconds) falls inside any `[start, end]` range.
function inAnyRange(t, ranges) {
  return ranges.some(([start, end]) => t >= start && t <= end);
}

// "MM:SS", or "H:MM:SS" past the hour mark. Matches the inline markers
// buildCleanTranscript sprinkles through the transcript text, and what the
// summarizer is told to copy verbatim into timestamp links (see
// buildYoutubeAssemblyPrompt in lib/summarize/prompts.js).
function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Minimum gap between inline [MM:SS] markers threaded through the
// transcript text below: fine enough for the summarizer to cite specific
// moments, coarse enough not to bloat the token count with one marker per
// (often very short) caption line.
const TIMESTAMP_MARKER_INTERVAL_SECONDS = 20;

// High-precision sponsor-read openers, used only as a fallback when a video
// has no SponsorBlock data. Kept deliberately narrow so we don't cut
// substantive content; each match drops a ~45s window (a typical read length)
// starting slightly before the trigger.
const SPONSOR_TRIGGERS = [
  /sponsored by/i,
  /this (?:video|episode) is (?:sponsored|brought to you)/i,
  /today'?s sponsor/i,
  /thanks? to .{0,40}? for sponsoring/i,
  /\buse (?:the )?(?:promo |discount )?code\b/i,
  /\bpromo code\b/i,
  /link in the (?:description|bio)/i,
  /use my link/i,
  /\bhead (?:over )?to \S{0,30}?\.com\b/i,
];

const SPONSOR_WINDOW_LEAD = 3; // seconds trimmed before a trigger
const SPONSOR_WINDOW_LEN = 45; // seconds dropped from a trigger onward

// Local, network-free fallback: drop segments within a window of any segment
// whose text matches a sponsor-read opener.
function heuristicStripSponsors(segments) {
  const windows = [];
  for (const seg of segments) {
    if (SPONSOR_TRIGGERS.some((re) => re.test(seg.text))) {
      windows.push([
        seg.start - SPONSOR_WINDOW_LEAD,
        seg.start + SPONSOR_WINDOW_LEN,
      ]);
    }
  }
  if (!windows.length) return segments;
  return segments.filter((seg) => !inAnyRange(seg.start, windows));
}

// Removes sponsor / self-promo / subscribe-plug segments from the timed
// transcript before it ever reaches the summarizer (far more reliable than
// asking a small model to "ignore sponsors"). Prefers SponsorBlock's
// crowdsourced timestamps, fetched via the service worker, which sends only a
// privacy-preserving 4-char hash prefix of the video id; when a video has no
// SponsorBlock data, falls back to the local phrase heuristic. Returns a
// plain transcript string with inline [MM:SS] markers (see
// TIMESTAMP_MARKER_INTERVAL_SECONDS) so the summarizer can cite specific
// moments and build "jump to this part" links (see lib/summarize/prompts.js /
// lib/summarize/youtubeSummarize.js), replacing the old flat, marker-free string this
// used to return.
async function buildCleanTranscript(segments, videoId) {
  if (!segments.length) return "";

  let ranges = [];
  if (videoId) {
    try {
      const resp = await chrome.runtime.sendMessage({
        target: "service-worker",
        action: "sponsorblock-segments",
        payload: { videoId },
      });
      ranges = Array.isArray(resp?.segments) ? resp.segments : [];
    } catch {
      // Service worker unreachable / context invalidated, fall back below.
      ranges = [];
    }
  }

  const kept = ranges.length
    ? segments.filter((seg) => !inAnyRange(seg.start, ranges))
    : heuristicStripSponsors(segments);

  let lastMarked = -Infinity;
  const parts = [];
  for (const seg of kept) {
    if (seg.start - lastMarked >= TIMESTAMP_MARKER_INTERVAL_SECONDS) {
      parts.push(`[${formatTimestamp(seg.start)}]`);
      lastMarked = seg.start;
    }
    parts.push(seg.text);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Handles both caption formats: `json3` (an `events[].segs[].utf8` structure)
// and the legacy XML (`<text>` nodes). Detects which by sniffing the payload.
// Returns timed segments (`[{ start, text }]`, start in seconds) rather than a
// flat string, so sponsor time-ranges from SponsorBlock can later be mapped
// onto the transcript to drop the sponsored parts.
function parseTranscript(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return (data.events || [])
        .map((e) => ({
          start: (e.tStartMs ?? 0) / 1000,
          text: (e.segs || [])
            .map((s) => s.utf8 || "")
            .join("")
            .replace(/\s+/g, " ")
            .trim(),
        }))
        .filter((seg) => seg.text);
    } catch {
      return [];
    }
  }
  const doc = new DOMParser().parseFromString(raw, "text/xml");
  return Array.from(doc.getElementsByTagName("text"))
    .map((node) => ({
      start: parseFloat(node.getAttribute("start") || "0") || 0,
      text: decodeHtmlEntities(node.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((seg) => seg.text);
}

// Strips marketing boilerplate (sponsor reads, CTAs, social/affiliate links,
// chapter dumps, hashtags) from a description so it doesn't leak into
// summaries, most damaging on videos with no transcript.
function cleanDescription(description) {
  if (!description) return "";

  const promoPatterns = [
    /\bsubscribe\b/i,
    /\bfollow (me|us|along)\b/i,
    /\blike,? (and|&) subscribe\b/i,
    /\bhit the bell\b/i,
    /\bturn on notifications\b/i,
    /\bcheck out\b/i,
    /\bsponsor(ed|ship)?\b/i,
    /\bpromo ?code\b/i,
    /\buse code\b/i,
    /\bdiscount\b/i,
    /\baffiliate\b/i,
    /\bmerch\b/i,
    /\bpatreon\b/i,
    /\bko-?fi\b/i,
    /\bjoin (this|our|my) (channel|membership|discord)\b/i,
    /\b(instagram|twitter|tiktok|facebook|discord|threads)\b/i,
    /\bfollow us on\b/i,
    // The trailing "|" here used to leave the "it/out/now" group able to
    // match on nothing, so "try" appearing anywhere on a line combined with
    // any later occurrence of the extremely common word "at" matched almost
    // every line in a typical description. Requiring one of the three
    // alternatives keeps this targeted at actual "try it/out/now ... free"
    // pitches.
    /\btry (it|out|now)\b.*\b(free|at)\b/i,
    /\bfor free at\b/i,
    /\bget your (first|free)\b/i,
    /\bsign up\b/i,
    /\bavailable in (multiple|other|several|\w+ languages?|spanish|french|german|portuguese|italian|hindi|arabic|japanese|korean|russian|chinese)\b/i,
    /\blinks? (below|in the description)\b/i,
    /^(chapters?|timestamps?|links?|social(s)?)\s*:?\s*$/i,
  ];

  // A dedicated, anchored check for hashtag-dump lines ("#AI #ML #Tech"),
  // rather than folding `#\w+` into promoPatterns above, that unanchored
  // form matched (and dropped) any line merely *containing* one hashtag
  // anywhere, including a substantive sentence that happens to mention one
  // mid-paragraph (e.g. "Check out my post about #AI in healthcare").
  const hashtagOnlyLine = /^(#\w+[\s,]*)+$/;

  const timestampLine = /^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\b/;
  const urlOnlyLine = /^\s*(https?:\/\/|www\.)\S+\s*$/i;

  const kept = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (timestampLine.test(line)) return false;
      if (urlOnlyLine.test(line)) return false;
      if (hashtagOnlyLine.test(line)) return false;
      if (promoPatterns.some((re) => re.test(line))) return false;
      return true;
    });

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A description line that opens with a chapter timestamp: an optional bullet,
// then "M:SS" / "MM:SS" / "H:MM:SS", then the chapter title. Anchoring the
// timestamp to the line start (not just anywhere in the line) keeps prose like
// "check out 3:45 in the video" from being mistaken for a chapter.
const CHAPTER_LINE =
  /^\s*(?:[-•*]\s*)?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b[\s\-–—:.)]*(.+?)\s*$/;

// Parses YouTube chapters out of a raw video description. Returns
// `[{ start, title }]` (start in seconds) only when the lines form a real
// chapter list by YouTube's own activation rules — at least three chapters,
// the first at 0:00, strictly increasing — otherwise `[]`. lib/summarize/youtubeChapters.js
// parses the block this feeds into; keep the emitted format below in sync.
function parseDescriptionChapters(description, durationSeconds) {
  if (!description) return [];

  const byStart = new Map();
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(CHAPTER_LINE);
    if (!m) continue;
    const [, h, mm, ss, titleRaw] = m;
    const start = (h ? Number(h) * 3600 : 0) + Number(mm) * 60 + Number(ss);
    const title = titleRaw.trim().replace(/\s+/g, " ");
    if (!title || title.length > 100) continue;
    // First title wins for a repeated timestamp; a Map also sorts nothing, so
    // we sort explicitly below.
    if (!byStart.has(start)) byStart.set(start, title);
  }

  let chapters = [...byStart.entries()]
    .map(([start, title]) => ({ start, title }))
    .sort((a, b) => a.start - b.start);

  // Drop stray timestamps past the video's end before validating.
  if (durationSeconds) {
    chapters = chapters.filter((c) => c.start <= durationSeconds);
  }

  if (chapters.length < 3 || chapters[0].start !== 0) return [];
  return chapters;
}

async function extractYoutube() {
  const playerResponse = getPlayerResponse();
  const videoDetails = playerResponse?.videoDetails;

  const title =
    videoDetails?.title ||
    document.querySelector("h1.ytd-watch-metadata")?.innerText ||
    document.title;

  const channel =
    videoDetails?.author ||
    document.querySelector("#channel-name a")?.innerText ||
    document.querySelector("ytd-channel-name a")?.innerText ||
    "";

  // videoDetails.shortDescription is the full description text; the DOM
  // version is clipped behind a "...more" toggle unless the viewer expands it.
  const description =
    videoDetails?.shortDescription ||
    document.querySelector("#description-inline-expander")?.innerText ||
    document.querySelector("#description ytd-text-inline-expander")
      ?.innerText ||
    "";

  const durationSeconds = videoDetails?.lengthSeconds
    ? Number(videoDetails.lengthSeconds)
    : 0;
  const duration = durationSeconds
    ? `${Math.round(durationSeconds / 60)} min`
    : "";

  // Grab visible comments if available (YouTube lazy-loads these on scroll,
  // so this only sees whatever has already rendered).
  const commentEls = document.querySelectorAll(
    "#content-text.ytd-comment-renderer",
  );
  const comments = Array.from(commentEls)
    .slice(0, 25)
    .map((el) => el.innerText.trim())
    .filter(Boolean);

  // Grab video metadata (views, date)
  const infoEl = document.querySelector("#info-strings");
  const info = infoEl ? infoEl.innerText.trim() : "";

  const videoId =
    videoDetails?.videoId ||
    new URLSearchParams(location.search).get("v") ||
    "";
  const transcriptSegments = await fetchTranscript(playerResponse);
  const transcript = await buildCleanTranscript(transcriptSegments, videoId);

  // With a transcript the description is just context, so cap it short.
  let cleanedDescription = cleanDescription(description);
  if (transcript && cleanedDescription.length > 500) {
    cleanedDescription = `${cleanedDescription.slice(0, 500).trim()}…`;
  }

  // Anti-hallucination ceiling for the summarizer's timestamp links (see
  // buildYoutubeAssemblyPrompt in lib/summarize/prompts.js): the last caption actually
  // seen, not lengthSeconds, since a sponsor-stripped tail or a video with
  // partial captions means the transcript itself may end earlier.
  const lastAvailableSeconds = transcriptSegments.length
    ? transcriptSegments[transcriptSegments.length - 1].start
    : 0;

  let content = `Video Title:\n${title}\n`;
  if (channel) content += `\nChannel: ${channel}\n`;
  if (duration) content += `\nDuration: ${duration}\n`;
  if (info) content += `\n${info}\n`;
  if (cleanedDescription) content += `\nDescription:\n${cleanedDescription}\n`;
  // Chapters come from the RAW description (cleanDescription strips its
  // timestamp lines). Only meaningful alongside a transcript, since the brief
  // fills each chapter from transcript content. Emitted as a machine-parseable
  // block (see lib/summarize/youtubeChapters.js) that lib/summarize/youtubeSummarize.js turns into
  // a chaptered brief.
  const chapters = transcript
    ? parseDescriptionChapters(description, durationSeconds)
    : [];
  if (chapters.length) {
    content += `\nChapters:\n${chapters
      .map((c) => `- [${formatTimestamp(c.start)}] ${c.title}`)
      .join("\n")}\n`;
  }
  content += transcript
    ? `\nLast transcript timestamp: ${formatTimestamp(lastAvailableSeconds)} (${Math.floor(lastAvailableSeconds)}s)\n\nTranscript:\n${transcript}\n`
    : "\n(No transcript/captions available for this video.)\n";
  if (comments.length > 0) {
    content += `\nTop Comments:\n${comments.map((c) => `- ${c}`).join("\n")}\n`;
  }

  return {
    type: "youtube",
    title,
    url: location.href,
    content,
    // Raw seconds (not the rounded "N min" string folded into `content`
    // above) so popup.js's time-saved badge can measure against the video's
    // actual runtime instead of a word-count estimate of the transcript.
    durationSeconds,
  };
}
