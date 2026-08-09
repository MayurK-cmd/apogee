let enabled = false;

export function setDebugLogging(on) {
  enabled = on === true;
}

export function isDebugLogging() {
  return enabled;
}

export function debugLog(...args) {
  if (enabled) console.log(...args);
}

export async function initDebugLogging() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    setDebugLogging(settings?.debugLogs === true);
  } catch {}
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    setDebugLogging(changes.settings.newValue?.debugLogs === true);
  });
}
