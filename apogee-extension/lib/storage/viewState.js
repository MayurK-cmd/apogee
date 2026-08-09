import { hashUrl, shouldPersist } from "./pageCache.js";
import { createLock } from "../util/mutex.js";

function viewStateKey(tabId) {
  return `popupViewState:${tabId}`;
}

const MAX_VIEW_STATES = 50;

const acquireViewStateLock = createLock();

export async function saveViewState(tabId, partial) {
  if (tabId == null) return null;
  let scrubContent = false;
  if (partial.url) {
    scrubContent = !(await shouldPersist(partial.url));
    partial = {
      ...partial,
      url: undefined,
      urlHash: await hashUrl(partial.url),
    };
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
