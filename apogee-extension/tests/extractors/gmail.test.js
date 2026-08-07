// Worked example 3 of 3: the simplest shape. Synchronous, DOM only, no shared
// thread machinery. Start here if you're writing your first extractor test.

import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const URL_INBOX = "https://mail.google.com/mail/u/0/#inbox";
const URL_THREAD = "https://mail.google.com/mail/u/0/#inbox/FMfcgz123456";

test("extractGmail pulls every message in an open thread", () => {
  const { extractGmail } = loadExtractors({
    files: ["extractors/gmail.js"],
    url: URL_THREAD,
    fixture: "gmail-thread.html",
  });

  const result = extractGmail();

  assert.strictEqual(result.type, "gmail");
  assert.strictEqual(result.title, "Roadmap review");
  assert.strictEqual(result.url, URL_THREAD);
  assert.match(
    result.content,
    /--- Message 1 from alice@example\.com \(Mon, 3 Aug 2026 09:14:00\) ---/,
  );
  assert.match(result.content, /Can we push the roadmap review to Thursday\?/);
  assert.match(result.content, /Attachments: roadmap-draft\.pdf/);
  assert.match(
    result.content,
    /--- Message 2 from bob@example\.com \(Mon, 3 Aug 2026 09:41:00\) ---/,
  );
});

test("extractGmail returns empty content when no thread is open", () => {
  const { extractGmail } = loadExtractors({
    files: ["extractors/gmail.js"],
    url: URL_INBOX,
    // The inbox list has no .a3s message bodies. Returning empty content rather
    // than null is deliberate: popup.js turns it into "nothing to summarize
    // here yet" instead of falling through to Readability, which would dump the
    // inbox chrome at the model.
    // Inline HTML has to be well-formed: linkedom parses literally and won't
    // synthesize <html>/<head> around a stray <title> the way a browser does.
    html: '<!doctype html><html><head><title>Inbox - Gmail</title></head><body><div class="ain"></div></body></html>',
  });

  const result = extractGmail();

  assert.strictEqual(result.type, "gmail");
  assert.strictEqual(result.content, "");
  assert.strictEqual(result.title, "Inbox - Gmail");
});
