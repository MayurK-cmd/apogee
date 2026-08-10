// Pages the browser itself refuses to let extensions script, even though they
// are ordinary https URLs. Without this the raw engine error ("The extensions
// gallery cannot be scripted.") leaks into the popup.
const BLOCKED_PAGES = [
  { host: "chromewebstore.google.com", label: "the Chrome Web Store" },
  {
    host: "chrome.google.com",
    path: "/webstore",
    label: "the Chrome Web Store",
  },
  { host: "addons.mozilla.org", label: "Firefox Add-ons" },
  { host: "accounts.firefox.com", label: "Firefox Accounts" },
];

export function unscriptableReason(url) {
  if (!/^https?:|^file:/i.test(url || "")) {
    return "Apogee can't read this page. Browser-internal pages aren't accessible to extensions, try a regular webpage instead.";
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const blocked = BLOCKED_PAGES.find(
    (page) =>
      page.host === hostname &&
      (!page.path || parsed.pathname.startsWith(page.path)),
  );
  if (!blocked) return null;

  return `Apogee can't read ${blocked.label}. Browsers block extensions from running on this page, try a regular webpage instead.`;
}

// Fallback for pages the blocklist above doesn't know about (enterprise policy
// blocks, other builtin galleries) so the browser's own wording never surfaces.
export function injectionErrorMessage(err) {
  const raw = err?.message || String(err || "");
  if (
    /cannot be scripted|cannot access|blocked|not allowed|denied/i.test(raw)
  ) {
    return "Apogee can't read this page. The browser blocks extensions from running here, try a regular webpage instead.";
  }
  return raw || "Apogee couldn't read this page.";
}

export async function extractFromActiveTab(tab) {
  const tabId = tab.id;

  const blockedReason = unscriptableReason(tab.url);
  if (blockedReason) throw new Error(blockedReason);

  const expectedVersion = chrome.runtime.getManifest().version;
  let injectedVersion = null;
  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        typeof window.extractPageContent === "function"
          ? window.__apogeeExtractorVersion || "unknown"
          : null,
    });
    injectedVersion = checkResult?.[0]?.result;
  } catch {}

  if (injectedVersion !== expectedVersion) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          "/content/Readability.js",
          "/content/extractors/generic.js",
          "/content/extractors/youtube.js",
          "/content/extractors/bilibili.js",
          "/content/extractors/gmail.js",
          "/content/extractors/thread.js",
          "/content/extractors/hackernews.js",
          "/content/extractors/reddit.js",
          "/content/extractors/github.js",
          "/content/extractors/wikipedia.js",
          "/content/content.js",
        ],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (v) => {
          window.__apogeeExtractorVersion = v;
        },
        args: [expectedVersion],
      });
    } catch (e) {
      throw new Error(injectionErrorMessage(e), { cause: e });
    }
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        return await window.extractPageContent();
      } catch (e) {
        return { error: e?.message || String(e) };
      }
    },
  });

  const pageData = results?.[0]?.result;
  if (pageData?.error) throw new Error(pageData.error);
  return pageData || null;
}

export async function extractPdfContent(tab) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const res = await fetch(window.location.href);
      if (!res.ok) throw new Error(`Failed to download PDF: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    },
  });
  const pdfBase64 = results?.[0]?.result;
  if (!pdfBase64) throw new Error("Could not download PDF.");

  const response = await chrome.runtime.sendMessage({
    target: "service-worker",
    action: "extract-pdf",
    payload: { pdfBase64 },
  });
  if (response?.error) throw new Error(response.error);
  return response?.text || "";
}
