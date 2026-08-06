// Opt-in diagnostic logging for the engine hosts (the offscreen document on
// Chrome, the service worker on Firefox). Model loading emits a running
// commentary - library loaded, WASM backend ready, pipeline built, first token
// - which is exactly what you want when a load appears to hang, and pure noise
// in every other session. It is therefore gated on the `debugLogs` setting,
// which the popup's "Show logs" panel flips (see toggleDebugLogsBtn in
// popup.js).
//
// Errors never route through here: console.error is unconditional, since a
// failure the user can't see is worse than a noisy console.

let enabled = false;

/** Mirrors the `debugLogs` setting into this execution context. */
export function setDebugLogging(on) {
  enabled = on === true;
}

export function isDebugLogging() {
  return enabled;
}

/** console.log, but only while diagnostics are switched on. */
export function debugLog(...args) {
  if (enabled) console.log(...args);
}

/**
 * Loads the current setting and keeps it live. Called once per host at
 * startup: chrome.storage is the only channel shared by the popup (writer)
 * and the offscreen/worker hosts (readers), and the listener means toggling
 * the panel takes effect on the next job rather than the next browser
 * restart.
 */
export async function initDebugLogging() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    setDebugLogging(settings?.debugLogs === true);
  } catch {
    // Storage unavailable (context tearing down); default of off stands.
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    setDebugLogging(changes.settings.newValue?.debugLogs === true);
  });
}
