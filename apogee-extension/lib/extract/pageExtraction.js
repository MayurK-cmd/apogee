export async function extractFromActiveTab(tab) {
  const tabId = tab.id;

  if (!/^https?:|^file:/i.test(tab.url || "")) {
    throw new Error(
      "Apogee can't read this page. Browser-internal pages aren't accessible to extensions, try a regular webpage instead.",
    );
  }

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
