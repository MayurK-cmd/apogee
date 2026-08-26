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

function getBiliInitialState() {
  const scripts = Array.from(document.querySelectorAll("script")).filter(
    (s) => s && (typeof s.isConnected === "undefined" || s.isConnected),
  );
  for (const script of scripts) {
    const text = script?.textContent || "";
    if (!text || !text.includes("__INITIAL_STATE__")) continue;
    const assign = text.match(/window\.__INITIAL_STATE__\s*=\s*/);
    if (!assign) continue;
    const openIndex = text.indexOf("{", assign.index + assign[0].length);
    if (openIndex === -1) continue;
    const json = biliExtractBalancedObject(text, openIndex);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {}
  }
  return null;
}

function biliFormatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const BILI_TIMESTAMP_MARKER_INTERVAL_SECONDS = 20;

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

async function extractBilibili() {
  const state = getBiliInitialState();
  const videoData = state?.videoData;
  if (!videoData || !videoData.title) return null;

  const title = videoData.title;
  const channel = videoData.owner?.name || "";
  const description = videoData.desc || videoData.dynamic || "";

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
    durationSeconds,
  };
}
