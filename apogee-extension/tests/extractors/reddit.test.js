import test from "node:test";
import assert from "node:assert";
import { loadExtractors, readJsonFixture } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/reddit.js"];
const THREAD_URL =
  "https://www.reddit.com/r/programming/comments/abc123/what_finally_made_caching_click_for_you/";

function stubFetch(payload, { ok = true } = {}) {
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push({ url, options });
    return { ok, json: async () => payload };
  };
  return { fetchStub, calls };
}

function load(url, fetchStub) {
  return loadExtractors({
    files: FILES,
    url,
    html: "<!doctype html><html><head><title>Reddit</title></head><body></body></html>",
    fetch: fetchStub,
  });
}

test("extractReddit summarizes a comment permalink from the JSON API", async () => {
  const { fetchStub } = stubFetch(readJsonFixture("reddit-comments.json"));
  const { extractReddit } = load(THREAD_URL, fetchStub);

  const result = await extractReddit();

  assert.strictEqual(result.type, "reddit");
  assert.strictEqual(result.title, "What finally made caching click for you?");
  assert.match(
    result.content,
    /r\/programming \| u\/alice \| 842 points \| 3 comments \| \[Discussion\]/,
  );
  assert.match(result.content, /Post:\nI struggled with invalidation/);
  assert.match(
    result.content,
    /\[1\] <replies: 1> \(score: 210\) bob: Thinking of a cache/,
  );
  assert.match(
    result.content,
    /\[1\.1\] \(score: 74\) carol: And a TTL is just/,
  );
  assert.match(result.content, /\[2\] \(score: 18\) erin: Write-through/);
});

test("extractReddit skips deleted bodies and load-more stubs", async () => {
  const { fetchStub } = stubFetch(readJsonFixture("reddit-comments.json"));
  const { extractReddit } = load(THREAD_URL, fetchStub);

  const content = (await extractReddit()).content;

  assert.doesNotMatch(content, /dave/);
  assert.doesNotMatch(content, /\[deleted\]/);
});

test("extractReddit requests the same-origin JSON endpoint", async () => {
  const { fetchStub, calls } = stubFetch(
    readJsonFixture("reddit-comments.json"),
  );
  const { extractReddit } = load(THREAD_URL, fetchStub);

  await extractReddit();

  assert.strictEqual(calls.length, 1);
  assert.ok(
    calls[0].url.startsWith(
      "https://www.reddit.com/r/programming/comments/abc123/what_finally_made_caching_click_for_you.json",
    ),
    `unexpected request URL: ${calls[0].url}`,
  );
  assert.strictEqual(calls[0].options.credentials, "omit");
});

test("extractReddit returns null on a listing page", async () => {
  const { extractReddit } = load(
    "https://www.reddit.com/r/programming/",
    undefined,
  );

  assert.strictEqual(await extractReddit(), null);
});

test("extractReddit returns null when the API request fails", async () => {
  const { fetchStub } = stubFetch(null, { ok: false });
  const { extractReddit } = load(THREAD_URL, fetchStub);

  assert.strictEqual(await extractReddit(), null);
});
