export const MIN_SELECTION_LENGTH = 20;

export function normalizeSelectedText(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

export function isSummarizableSelection(text) {
  return normalizeSelectedText(text).length >= MIN_SELECTION_LENGTH;
}

export async function activateSelectionCapture(tab) {
  if (!tab?.id || typeof chrome === "undefined") return false;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (minLength) => {
      if (window.__apogeeSelectionCapture) return;
      window.__apogeeSelectionCapture = true;
      let sent = false;
      const capture = () => {
        if (sent) return;
        const text = window
          .getSelection()
          ?.toString()
          .replace(/\s+/g, " ")
          .trim();
        if (!text || text.length < minLength) return;
        sent = true;
        chrome.runtime.sendMessage({
          target: "service-worker",
          action: "summarize-selection",
          payload: { selectionText: text },
        });
        document.removeEventListener("selectionchange", capture, true);
        window.removeEventListener("mouseup", capture, true);
        delete window.__apogeeSelectionCapture;
      };
      document.addEventListener("selectionchange", capture, true);
      window.addEventListener("mouseup", capture, true);
    },
    args: [MIN_SELECTION_LENGTH],
  });
  return true;
}
