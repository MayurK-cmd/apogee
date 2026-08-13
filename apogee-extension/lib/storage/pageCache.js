import { getSettings } from "./settings.js";
import { sha256Hex } from "../util/hash.js";
import { createLock } from "../util/mutex.js";

const acquireIndexLock = createLock();

export const CACHEABLE_PAGE_TYPES = new Set([
  "article",
  "generic",
  "wikipedia",
]);

export async function hashUrl(url) {
  return sha256Hex(url);
}

// Everything that changes the generated text has to be part of the key, or a
// cached answer from the old settings comes back and the change looks ignored.
// That means the url, the response format, the model, the output language, and
// the custom instructions, which are folded into the prompt. Anything else that
// starts feeding the prompt belongs here too.
//
// The instructions suffix is left off entirely when there are none, so keys for
// the default settings keep the shape they had before custom instructions
// existed and those cached summaries stay reachable.
async function instructionsSuffix(customInstructions) {
  const extra = (customInstructions || "").trim();
  if (!extra) return "";
  return `:i${(await sha256Hex(extra)).slice(0, 12)}`;
}

export async function getSummaryCacheKey(
  url,
  fmt,
  model,
  lang = "auto",
  customInstructions = "",
) {
  return `summary:${fmt}:${lang}:${model}:${await hashUrl(url)}${await instructionsSuffix(customInstructions)}`;
}
export async function getPromptsCacheKey(
  url,
  fmt,
  model,
  lang = "auto",
  customInstructions = "",
) {
  return `suggested-prompts:${fmt}:${lang}:${model}:${await hashUrl(url)}${await instructionsSuffix(customInstructions)}`;
}
export async function getContentCacheKey(url) {
  return `content:${await hashUrl(url)}`;
}

export const MAX_CACHED_PAGES = 50;

export async function persistSummary(cacheKey, promptsCacheKey, text, title) {
  const release = await acquireIndexLock();
  try {
    const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
    const order = cacheOrder.filter((e) => e && e.s !== cacheKey);
    order.push({ s: cacheKey, p: promptsCacheKey, t: title || "" });

    const removeKeys = [];
    while (order.length > MAX_CACHED_PAGES) {
      const old = order.shift();
      if (old?.s) removeKeys.push(old.s);
      if (old?.p) removeKeys.push(old.p);
    }

    await chrome.storage.local.set({ [cacheKey]: text, cacheOrder: order });
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  } finally {
    release();
  }
}

export async function persistContent(url, pageData) {
  const release = await acquireIndexLock();
  try {
    const contentKey = await getContentCacheKey(url);
    const { contentCacheOrder = [] } =
      await chrome.storage.local.get("contentCacheOrder");
    const order = contentCacheOrder.filter((k) => k !== contentKey);
    order.push(contentKey);

    const removeKeys = [];
    while (order.length > MAX_CACHED_PAGES) {
      removeKeys.push(order.shift());
    }

    const persistable = { ...pageData };
    delete persistable.url;

    await chrome.storage.local.set({
      [contentKey]: persistable,
      contentCacheOrder: order,
    });
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  } finally {
    release();
  }
}

export async function getCachedContent(url) {
  const contentKey = await getContentCacheKey(url);
  const stored = await chrome.storage.local.get(contentKey);
  if (!stored[contentKey]) return null;
  return { ...stored[contentKey], url };
}

const SENSITIVE_HOST_PATTERNS = [
  /(^|\.)mail\.google\.com$/,
  /(^|\.)outlook\.(live|office|office365)\.com$/,
  /(^|\.)mail\.proton\.me$/,
  /(^|\.)mail\.yahoo\.com$/,
  /(^|\.)messages\.google\.com$/,
  /(^|\.)web\.whatsapp\.com$/,
  /(^|\.)web\.telegram\.org$/,
  /(^|\.)app\.slack\.com$/,
  /(^|\.)discord\.com$/,
  /(^|\.)teams\.microsoft\.com$/,
  /(^|\.)teams\.live\.com$/,
];

export function isSensitiveUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SENSITIVE_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

// The list above is fixed, and it can only ever cover the webmail and chat
// hosts we thought of. A self-hosted mail server, a patient portal, or a
// company wiki is just as private to the person reading it, so they can name
// their own hosts. Entries are forgiving about how they are written: a pasted
// url, a leading "*.", "www.", a trailing slash, and separators of newline,
// comma, or space all normalize to a bare hostname.
export function parsePrivateHosts(raw) {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((entry) => {
      const trimmed = entry.trim().toLowerCase();
      if (!trimmed) return "";
      const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
      const hostOnly = withoutScheme.split(/[/?#]/)[0];
      return hostOnly.replace(/^\*\./, "").replace(/^www\./, "");
    })
    .filter((host) => host && host.includes("."));
}

export function matchesPrivateHost(url, rawHosts) {
  const hosts = parsePrivateHosts(rawHosts);
  if (hosts.length === 0) return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // A named host covers its subdomains, so "example.com" also means
  // "mail.example.com", the way the built-in patterns behave.
  return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Whether a url is private, by either the built-in list or the user's own.
 * Pass settings when the caller already has them, to avoid a second read.
 */
export async function isPrivateUrl(url, settings = null) {
  if (isSensitiveUrl(url)) return true;
  const resolved = settings || (await getSettings());
  return matchesPrivateHost(url, resolved.privateHosts);
}

export async function shouldPersist(url) {
  if (isSensitiveUrl(url)) return false;
  const settings = await getSettings();
  if (matchesPrivateHost(url, settings.privateHosts)) return false;
  return settings.saveHistory !== false;
}
