import test from "node:test";
import assert from "node:assert/strict";
import {
  recordPageAccessEvent,
  getPageAccessLog,
  clearPageAccessLog,
  getActivityAuditSummary,
} from "../../lib/storage/activityAudit.js";

// Mock chrome storage
const storageMap = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys === null) {
          const res = {};
          for (const [k, v] of storageMap.entries()) res[k] = v;
          return res;
        }
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) {
            if (storageMap.has(k)) res[k] = storageMap.get(k);
          }
          return res;
        }
        return {};
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) storageMap.set(k, v);
      },
      remove: async (keys) => {
        for (const k of keys) storageMap.delete(k);
      },
    },
  },
};

test("recordPageAccessEvent stores audit entries and caps at 20", async () => {
  await clearPageAccessLog();
  for (let i = 1; i <= 25; i++) {
    await recordPageAccessEvent({
      title: `Test Page ${i}`,
      url: `https://example.com/page${i}`,
      contentLength: 500 * i,
      type: "generic",
    });
  }

  const logs = await getPageAccessLog();
  assert.equal(logs.length, 20);
  assert.equal(logs[0].title, "Test Page 25");
});

test("getActivityAuditSummary returns privacy & activity audit metrics", async () => {
  await clearPageAccessLog();
  await recordPageAccessEvent({
    title: "Privacy Test",
    url: "https://example.org",
    contentLength: 1200,
    type: "article",
  });

  const summary = await getActivityAuditSummary();
  assert.equal(summary.pageAccessCount, 1);
  assert.equal(typeof summary.networkEgress.statusMessage, "string");
  assert.equal(typeof summary.storageRetention.saveHistory, "boolean");
});
