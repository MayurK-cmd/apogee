/**
 * Checks whether the extension currently has granted host permissions for the specified origins.
 * @param {string[]} origins List of origin match patterns (e.g. ["*://*.bilibili.com/*"])
 * @returns {Promise<boolean>}
 */
export async function hasHostPermissions(origins) {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
    return true;
  }
  try {
    return await new Promise((resolve) => {
      chrome.permissions.contains({ origins }, (result) => {
        resolve(Boolean(result));
      });
    });
  } catch {
    return false;
  }
}

/**
 * Requests host permissions on demand for the specified origins.
 * @param {string[]} origins List of origin match patterns
 * @returns {Promise<boolean>}
 */
export async function requestHostPermissions(origins) {
  if (typeof chrome === "undefined" || !chrome.permissions?.request) {
    return true;
  }
  try {
    return await new Promise((resolve) => {
      chrome.permissions.request({ origins }, (granted) => {
        resolve(Boolean(granted));
      });
    });
  } catch {
    return false;
  }
}
