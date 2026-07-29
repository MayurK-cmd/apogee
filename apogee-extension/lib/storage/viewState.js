// Per-tab popup "what was on screen" state, shared by popup.js (reads it on
// every open to decide which view to restore) and background/service-worker.js
// (writes it when a context-menu/keyboard-shortcut-triggered summarize job
// starts, see runBackgroundSummarize, so opening the popup mid-job shows the
// loading/summarizing view and reattaches to the live stream, exactly like a
// popup-triggered summarize already does, instead of the default home page).
// Pure chrome.storage.local usage, no DOM/popup-only state.

import { hashUrl, shouldPersist } from "./pageCache.js";
import { createLock } from "../util/mutex.js";

function viewStateKey(tabId) {
  return `popupViewState:${tabId}`;
}

// Cap retained per-tab view states (each is keyed by tabId and can hold
// answer/summary text) with an oldest-first FIFO, like the other caches.
const MAX_VIEW_STATES = 50;

// Serializes this context's read-modify-write cycles on viewStateOrder (and
// the per-tab state merge), same rationale as pageCache.js's index lock:
// interleaved get→set from two concurrent writers could drop an index entry.
const acquireViewStateLock = createLock();

export async function saveViewState(tabId, partial) {
  if (tabId == null) return null;
  // Page-specific states carry a `url` (summary/answer/ask resume state);
  // pure app-navigation states (settings/home/contact) don't. What persists
  // is only a hash of the URL (same rationale as the hashed cache keys, see
  // hashUrl): it's needed solely for an equality check against the active tab
  // on restore, and the raw URL can carry session tokens in its query string.
  // Setting `url: undefined` also scrubs the raw copy older versions stored.
  //
  // When the page isn't persistable (sensitive host, or history off), the
  // state is still written, minus its content-bearing fields (question/
  // answerText/summaryText): the urlHash/streamId/promptsCacheKey pointer
  // contains no page content, and dropping it entirely (the old behavior)
  // made a
  // background-triggered summarize on such pages finish into a void, the
  // completion notification said "click to view", but with no stored streamId
  // the popup couldn't reattach and just showed Home.
  let scrubContent = false;
  if (partial.url) {
    scrubContent = !(await shouldPersist(partial.url));
    partial = { ...partial, url: undefined, urlHash: hashUrl(partial.url) };
  }
  const release = await acquireViewStateLock();
  try {
    const key = viewStateKey(tabId);
    const { viewStateOrder = [], ...rest } = await chrome.storage.local.get([
      key,
      "viewStateOrder",
    ]);
    const state = { ...(rest[key] || {}), ...partial };
    if (scrubContent) {
      // Also scrubs content fields a previous (persistable) page's state
      // left behind in the merge base, not just this partial's own.
      delete state.question;
      delete state.answerText;
      delete state.summaryText;
    }

    const order = viewStateOrder.filter((k) => k !== key);
    order.push(key);
    const removeKeys = [];
    while (order.length > MAX_VIEW_STATES) {
      removeKeys.push(order.shift());
    }

    await chrome.storage.local.set({ [key]: state, viewStateOrder: order });
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
    return state;
  } finally {
    release();
  }
}

export async function loadViewState(tabId) {
  if (tabId == null) return null;
  const key = viewStateKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

// Drops a tab's view state (which can hold a full question + answer text)
// along with its FIFO-index entry. Called from the service worker's
// tabs.onRemoved listener so a closed tab's state doesn't linger until it's
// eventually pushed out by MAX_VIEW_STATES eviction or a manual clear.
export async function removeViewState(tabId) {
  if (tabId == null) return;
  const release = await acquireViewStateLock();
  try {
    const key = viewStateKey(tabId);
    const { viewStateOrder = [] } =
      await chrome.storage.local.get("viewStateOrder");
    const order = viewStateOrder.filter((k) => k !== key);
    await chrome.storage.local.set({ viewStateOrder: order });
    await chrome.storage.local.remove(key);
  } finally {
    release();
  }
}
