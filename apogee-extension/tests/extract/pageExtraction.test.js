import test from "node:test";
import assert from "node:assert";

import {
  unscriptableReason,
  injectionErrorMessage,
} from "../../lib/extract/pageExtraction.js";

test("browser-internal pages are rejected before injection", () => {
  for (const url of [
    "chrome://extensions",
    "about:addons",
    "edge://settings",
    "chrome-extension://abcdef/app.html",
    "",
    undefined,
  ]) {
    const reason = unscriptableReason(url);
    assert.match(reason, /Browser-internal pages/);
  }
});

test("gallery pages the browser refuses to script are rejected", () => {
  assert.match(
    unscriptableReason("https://chromewebstore.google.com/detail/apogee/abc"),
    /Chrome Web Store/,
  );
  assert.match(
    unscriptableReason("https://chrome.google.com/webstore/detail/apogee/abc"),
    /Chrome Web Store/,
  );
  assert.match(
    unscriptableReason(
      "https://addons.mozilla.org/en-US/firefox/addon/apogee/",
    ),
    /Firefox Add-ons/,
  );
  assert.match(
    unscriptableReason("https://accounts.firefox.com/signin"),
    /Firefox Accounts/,
  );
});

test("blocked hosts are matched exactly, not by suffix", () => {
  assert.equal(
    unscriptableReason("https://notchromewebstore.google.com/x"),
    null,
  );
  assert.equal(
    unscriptableReason("https://chrome.google.com/intl/en/chrome/"),
    null,
  );
});

test("ordinary pages pass the pre-flight check", () => {
  for (const url of [
    "https://example.com/article",
    "http://localhost:3000/",
    "file:///home/user/notes.html",
    "https://en.wikipedia.org/wiki/Apogee",
  ]) {
    assert.equal(unscriptableReason(url), null);
  }
});

test("raw injection failures are rewritten into a friendly message", () => {
  const friendly = /The browser blocks extensions from running here/;
  assert.match(
    injectionErrorMessage(
      new Error("The extensions gallery cannot be scripted."),
    ),
    friendly,
  );
  assert.match(
    injectionErrorMessage(new Error("Cannot access contents of the page.")),
    friendly,
  );
  assert.match(
    injectionErrorMessage(new Error("This page is blocked by policy")),
    friendly,
  );
});

test("unrelated injection failures keep their original message", () => {
  assert.equal(
    injectionErrorMessage(new Error("No tab with id: 42.")),
    "No tab with id: 42.",
  );
  assert.equal(injectionErrorMessage(null), "Apogee couldn't read this page.");
});
