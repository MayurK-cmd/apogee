import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/lobsters.js"];

const LOBSTERS_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="story">
    <div class="story_title"><a class="u-url" href="https://example.com/blog/article">Understanding Caching</a></div>
    <div class="domain">example.com</div>
    <div class="byline">
      <span class="score">42</span>
      <a class="u-author" href="/u/alice">alice</a>
    </div>
  </div>
  <ol class="comments">
    <li class="comment indent_0">
      <div class="byline"><a class="u-author" href="/u/bob">bob</a></div>
      <div class="comment_text">Great overview of cache invalidation.</div>
    </li>
    <li class="comment indent_1">
      <div class="byline"><a class="u-author" href="/u/carol">carol</a></div>
      <div class="comment_text">Agreed, specially the section on TTLs.</div>
    </li>
  </ol>
</body>
</html>
`;

function extract(
  url = "https://lobste.rs/s/abc123/understanding_caching",
  html = LOBSTERS_HTML,
) {
  const { extractLobsters } = loadExtractors({
    files: FILES,
    url,
    html,
  });
  return extractLobsters();
}

test("extractLobsters pulls story metadata off a Lobste.rs story page", () => {
  const result = extract();
  assert.strictEqual(result.type, "lobsters");
  assert.strictEqual(result.title, "Understanding Caching");
  assert.strictEqual(
    result.url,
    "https://lobste.rs/s/abc123/understanding_caching",
  );
  assert.match(result.content, /^Lobste\.rs discussion/);
  assert.match(result.content, /Links to: example\.com/);
  assert.match(result.content, /42 points \| by alice/);
});

test("extractLobsters renders the comment tree in path notation", () => {
  const content = extract().content;
  assert.match(
    content,
    /\[1\] <replies: 1> bob: Great overview of cache invalidation\./,
  );
  assert.match(
    content,
    /\[1\.1\] carol: Agreed, specially the section on TTLs\./,
  );
});

test("extractLobsters returns null off a non-story page", () => {
  const result = extract("https://lobste.rs/recent");
  assert.strictEqual(result, null);
});
