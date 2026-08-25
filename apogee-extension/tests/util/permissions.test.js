import test from "node:test";
import assert from "node:assert";

import {
  hasHostPermissions,
  requestHostPermissions,
} from "../../lib/util/permissions.js";

test("hasHostPermissions returns true when chrome.permissions is undefined", async () => {
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  try {
    const result = await hasHostPermissions(["*://*.bilibili.com/*"]);
    assert.strictEqual(result, true);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("hasHostPermissions calls chrome.permissions.contains and returns true/false", async () => {
  const originalChrome = globalThis.chrome;
  let queriedOrigins = null;

  globalThis.chrome = {
    permissions: {
      contains({ origins }, callback) {
        queriedOrigins = origins;
        callback(origins.includes("*://*.bilibili.com/*"));
      },
    },
  };

  try {
    const hasBili = await hasHostPermissions(["*://*.bilibili.com/*"]);
    assert.strictEqual(hasBili, true);
    assert.deepStrictEqual(queriedOrigins, ["*://*.bilibili.com/*"]);

    const hasYoutube = await hasHostPermissions(["*://*.youtube.com/*"]);
    assert.strictEqual(hasYoutube, false);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("requestHostPermissions calls chrome.permissions.request and returns granted boolean", async () => {
  const originalChrome = globalThis.chrome;
  let requestedOrigins = null;

  globalThis.chrome = {
    permissions: {
      request({ origins }, callback) {
        requestedOrigins = origins;
        callback(true);
      },
    },
  };

  try {
    const granted = await requestHostPermissions(["*://*.bilibili.com/*"]);
    assert.strictEqual(granted, true);
    assert.deepStrictEqual(requestedOrigins, ["*://*.bilibili.com/*"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
