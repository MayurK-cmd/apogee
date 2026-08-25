import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/mastodon.js"];

const MASTODON_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="generator" content="Mastodon v4.2.0">
</head>
<body>
  <div class="activity-stream">
    <div class="detailed-status__wrapper detailed-status">
      <div class="detailed-status__display-name">
        <a class="u-author" href="https://mastodon.social/@alice">
          <strong>Alice Smith</strong>
          <span class="account__discreet">@alice@mastodon.social</span>
        </a>
      </div>
      <div class="detailed-status__content status__content">
        <div class="status__content__text">This is a main status post about open source AI development.</div>
      </div>
      <div class="detailed-status__action-bar">
        <span class="detailed-status__reblogs">12</span>
        <span class="detailed-status__favorites">45</span>
      </div>
    </div>
    <div class="thread">
      <div class="status__wrapper">
        <div class="status">
          <div class="status__display-name">
            <strong class="display-name__html">Bob Jones</strong>
            <span class="account__discreet">@bob@fosstodon.org</span>
          </div>
          <div class="status__content">
            <div class="status__content__text">Great insights! I completely agree with local-first inference.</div>
          </div>
        </div>
        <div class="status__wrapper">
          <div class="status">
            <div class="status__display-name">
              <strong class="display-name__html">Carol White</strong>
              <span class="account__discreet">@carol@hachyderm.io</span>
            </div>
            <div class="status__content">
              <div class="status__content__text">WebGPU makes this seamless in modern browsers.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

function extract(
  url = "https://mastodon.social/@alice/112233445566778899",
  html = MASTODON_HTML,
) {
  const { extractMastodon } = loadExtractors({
    files: FILES,
    url,
    html,
  });
  return extractMastodon();
}

test("extractMastodon pulls post metadata off a Mastodon status page", () => {
  const result = extract();
  assert.strictEqual(result.type, "mastodon");
  assert.strictEqual(
    result.title,
    "Mastodon post by Alice Smith (@alice@mastodon.social)",
  );
  assert.strictEqual(
    result.url,
    "https://mastodon.social/@alice/112233445566778899",
  );
  assert.match(result.content, /^Mastodon discussion/);
  assert.match(
    result.content,
    /Author: Alice Smith \(@alice@mastodon\.social\)/,
  );
  assert.match(result.content, /Engagement: 12 boosts \| 45 favorites/);
  assert.match(
    result.content,
    /This is a main status post about open source AI development\./,
  );
});

test("extractMastodon renders reply thread in path notation", () => {
  const content = extract().content;
  assert.match(
    content,
    /\[1\] <replies: 1> Bob Jones \(@bob@fosstodon\.org\): Great insights!/,
  );
  assert.match(
    content,
    /\[1\.1\] Carol White \(@carol@hachyderm\.io\): WebGPU makes this seamless/,
  );
});

test("extractMastodon returns null on non-Mastodon page", () => {
  const result = extract(
    "https://example.com/article",
    "<html><body><h1>Hello</h1></body></html>",
  );
  assert.strictEqual(result, null);
});
