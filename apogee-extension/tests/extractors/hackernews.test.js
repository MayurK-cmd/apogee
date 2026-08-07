// Worked example 1 of 3: a pure-DOM extractor that feeds the shared thread
// representation. Copy this file's shape when adding an extractor for another
// discussion site.

import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

// thread.js has to come first: hackernews.js calls the helpers it declares,
// matching the injection order in lib/extract/pageExtraction.js.
const FILES = ["extractors/thread.js", "extractors/hackernews.js"];

function extract(url = "https://news.ycombinator.com/item?id=100") {
  const { extractHackerNews } = loadExtractors({
    files: FILES,
    url,
    fixture: "hackernews-item.html",
  });
  return extractHackerNews();
}

test("extractHackerNews pulls the story metadata off an item page", () => {
  const result = extract();

  assert.strictEqual(result.type, "hackernews");
  assert.strictEqual(result.title, "A link post about caching");
  assert.strictEqual(result.url, "https://news.ycombinator.com/item?id=100");
  assert.match(result.content, /^Hacker News discussion/);
  assert.match(result.content, /Links to: example\.com/);
  assert.match(result.content, /128 points \| by alice \| 4 hours ago/);
});

test("extractHackerNews renders the comment tree in path notation", () => {
  const content = extract().content;

  // Depth comes from the `indent` attribute, so a reply nests under its parent
  // and the parent reports the reply.
  assert.match(
    content,
    /\[1\] <replies: 1> bob: Invalidation is the hard part/,
  );
  // carol reports no replies: her only one (dave) is filtered out for
  // downvotes below, and the count covers replies the model can actually see.
  assert.match(content, /\[1\.1\] carol: Agreed, though a TTL/);
});

test("extractHackerNews drops heavily downvoted and dead comments", () => {
  const content = extract().content;

  // dave's comment carries the c9c fade class, which is past HN_DOWNVOTE_LIMIT.
  assert.doesNotMatch(content, /dave/);
  // erin's row has no .commtext at all (flagged), so it holds its tree slot but
  // contributes no line.
  assert.doesNotMatch(content, /erin/);
});

test("extractHackerNews returns null off an item page so generic takes over", () => {
  const result = extract("https://news.ycombinator.com/newest");

  assert.strictEqual(result, null);
});
