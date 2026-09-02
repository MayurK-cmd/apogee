import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const URL = "https://example.com/2026/09/fixture-article";

function loadGeneric(html) {
  return loadExtractors({
    files: ["Readability.js", "extractors/generic.js"],
    url: URL,
    html,
  });
}

test("extractGeneric runs Readability over the page", () => {
  const html = `<!doctype html>
<html>
  <head>
    <title>The Real Title</title>
    <meta name="author" content="Alice">
  </head>
  <body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <main>
      <h1>The Real Title</h1>
      <p>First paragraph with enough words that Readability scores it as the article body instead of dismissing it as boilerplate.</p>
      <p>Second paragraph adds more depth, mentioning dates and places so the extracted content reads like a proper article.</p>
      <aside>Unrelated ad</aside>
    </main>
    <footer>Copyright boilerplate</footer>
  </body>
</html>`;

  const { extractGeneric } = loadGeneric(html);
  const result = extractGeneric();

  assert.strictEqual(result.type, "article");
  assert.strictEqual(result.title, "The Real Title");
  assert.strictEqual(result.url, URL);
  assert.match(result.content, /First paragraph/);
  assert.match(result.content, /Second paragraph/);
  assert.doesNotMatch(result.content, /Unrelated ad/);
  assert.doesNotMatch(result.content, /Copyright boilerplate/);
});

test("extractGeneric falls back to body text when Readability can't parse a page", () => {
  const html = `<!doctype html>
<html>
  <head><title>Empty Page</title></head>
  <body></body>
</html>`;

  const { extractGeneric } = loadGeneric(html);
  const result = extractGeneric();

  assert.strictEqual(result.type, "generic");
  assert.strictEqual(result.title, "Empty Page");
  assert.strictEqual(result.url, URL);
  assert.strictEqual(result.content, "");
});
