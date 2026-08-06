import test from "node:test";
import assert from "node:assert";

import {
  hashUrl,
  getSummaryCacheKey,
  getPromptsCacheKey,
  getContentCacheKey,
  persistSummary,
  isSensitiveUrl,
  shouldPersist,
  MAX_CACHED_PAGES,
} from "../../lib/storage/pageCache.js";

// Same in-memory chrome.storage.local fake convention tests/attachToStream.test.js
// establishes for chrome.runtime, backed by a plain object instead of ports.
function installFakeStorage(initial = {}) {
  const data = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return { ...data };
          if (typeof keys === "string") return { [keys]: data[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) out[k] = data[k];
            return out;
          }
          return { ...data };
        },
        set: async (obj) => {
          Object.assign(data, obj);
        },
        remove: async (keys) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        },
      },
    },
  };
  return data;
}

test("hashUrl is deterministic and distinguishes different URLs", async () => {
  assert.strictEqual(
    await hashUrl("https://example.com/a"),
    await hashUrl("https://example.com/a"),
  );
  assert.notStrictEqual(
    await hashUrl("https://example.com/a"),
    await hashUrl("https://example.com/b"),
  );
});

test("hashUrl keeps no readable trace of the url it came from", async () => {
  // The whole point of hashing the key: a URL's query string can carry session
  // tokens, so nothing recognizable from it may survive into storage.
  const hash = await hashUrl("https://example.com/reset?token=hunter2");
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.ok(!hash.includes("hunter2"));
  assert.ok(!hash.includes("example"));
});

test("cache key helpers embed the hashed url and are namespaced by kind", async () => {
  const url = "https://example.com/article";
  const hash = await hashUrl(url);
  // Language segment defaults to "auto" when the caller omits it (older
  // 3-arg call sites), and is embedded when supplied so a different output
  // language is a distinct cache entry.
  assert.strictEqual(
    await getSummaryCacheKey(url, "bullets", "model-x"),
    `summary:bullets:auto:model-x:${hash}`,
  );
  assert.strictEqual(
    await getSummaryCacheKey(url, "bullets", "model-x", "es"),
    `summary:bullets:es:model-x:${hash}`,
  );
  assert.strictEqual(
    await getPromptsCacheKey(url, "bullets", "model-x"),
    `suggested-prompts:bullets:auto:model-x:${hash}`,
  );
  assert.strictEqual(
    await getPromptsCacheKey(url, "bullets", "model-x", "es"),
    `suggested-prompts:bullets:es:model-x:${hash}`,
  );
  assert.strictEqual(await getContentCacheKey(url), `content:${hash}`);
});

test("isSensitiveUrl matches known webmail/messaging hosts and their subdomains", () => {
  assert.ok(isSensitiveUrl("https://mail.google.com/mail/u/0/"));
  assert.ok(isSensitiveUrl("https://web.whatsapp.com/"));
  assert.ok(isSensitiveUrl("https://foo.teams.live.com/"));
  assert.ok(!isSensitiveUrl("https://example.com/"));
  assert.ok(!isSensitiveUrl("not a url at all"));
});

test("shouldPersist respects saveHistory for a non-sensitive host", async () => {
  installFakeStorage({ settings: { saveHistory: false } });
  assert.strictEqual(await shouldPersist("https://example.com/"), false);

  installFakeStorage({ settings: { saveHistory: true } });
  assert.strictEqual(await shouldPersist("https://example.com/"), true);
});

test("shouldPersist is always false for a sensitive host, regardless of saveHistory", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  assert.strictEqual(await shouldPersist("https://mail.google.com/"), false);
});

test("persistSummary evicts the oldest entry once the FIFO cap is exceeded", async () => {
  const data = installFakeStorage();

  for (let i = 0; i < MAX_CACHED_PAGES + 1; i++) {
    await persistSummary(
      `summary-key-${i}`,
      `prompts-key-${i}`,
      `text ${i}`,
      `Title ${i}`,
    );
  }

  assert.strictEqual(data.cacheOrder.length, MAX_CACHED_PAGES);
  // The very first entry (index 0) should have been evicted, both from the
  // order index and its own stored keys.
  assert.ok(!data.cacheOrder.some((e) => e.s === "summary-key-0"));
  assert.strictEqual(data["summary-key-0"], undefined);
  assert.strictEqual(data["prompts-key-0"], undefined);
  // The most recent entry should still be present.
  assert.strictEqual(
    data[`summary-key-${MAX_CACHED_PAGES}`],
    `text ${MAX_CACHED_PAGES}`,
  );
});

test("persistSummary re-persisting the same cacheKey doesn't duplicate its order entry", async () => {
  const data = installFakeStorage();

  await persistSummary("k1", "p1", "first", "Title");
  await persistSummary("k1", "p1", "updated", "Title");

  assert.strictEqual(data.cacheOrder.length, 1);
  assert.strictEqual(data.k1, "updated");
});
