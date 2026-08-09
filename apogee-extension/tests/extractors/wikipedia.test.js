import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const URL_ARTICLE = "https://en.wikipedia.org/wiki/Salt_marsh";

function extract(options = {}) {
  const { extractWikipedia } = loadExtractors({
    files: ["extractors/wikipedia.js"],
    url: URL_ARTICLE,
    fixture: "wikipedia-article.html",
    ...options,
  });
  return extractWikipedia();
}

test("extractWikipedia keeps the article prose", () => {
  const result = extract();

  assert.strictEqual(result.type, "wikipedia");
  assert.strictEqual(result.url, URL_ARTICLE);
  assert.match(result.content, /A salt marsh is a coastal ecosystem/);
  assert.match(result.content, /low-energy shorelines/);
  assert.match(result.content, /Cordgrass dominates the lower marsh/);
});

test("extractWikipedia emits headings as Markdown ATX", () => {
  const result = extract();

  assert.match(result.content, /^## Geomorphology$/m);
  assert.match(result.content, /^### Tidal flooding$/m);
  assert.match(result.content, /^## Ecology$/m);
});

test("extractWikipedia drops everything from the first appendix heading", () => {
  const result = extract();

  for (const gone of [
    "See also",
    "References",
    "External links",
    "Mudflat",
    "Saltmarsh Ecology",
    "Cambridge University Press",
    "The Marsh Project",
  ]) {
    assert.ok(
      !result.content.includes(gone),
      `expected the citation tail to be cut, but found "${gone}"`,
    );
  }
});

test("extractWikipedia strips page furniture and citation markers", () => {
  const result = extract();

  assert.ok(!result.content.includes("[1]"), "citation marker survived");
  assert.ok(!result.content.includes("[2]"), "citation marker survived");
  assert.ok(!result.content.includes("edit"), "edit-section link survived");
  assert.ok(!result.content.includes("Not to be confused"), "hatnote survived");
  assert.ok(
    !result.content.includes("Coastal ecosystem"),
    "short description survived",
  );
  assert.ok(
    !result.content.includes("A salt marsh in Brittany"),
    "figure caption survived",
  );
  assert.ok(!result.content.includes("Estuary"), "navbox survived");
  assert.ok(!result.content.includes("22,000"), "infobox survived");
});

test("extractWikipedia reports where the lead ends", () => {
  const result = extract();

  assert.ok(result.leadChars > 0);
  const lead = result.content.slice(0, result.leadChars);
  assert.match(lead, /A salt marsh is a coastal ecosystem/);
  assert.ok(!lead.includes("##"), "the lead stops at the first heading");
});

test("extractWikipedia returns null outside the article namespace", () => {
  const result = extract({
    html: `<body class="ns-1 ns-talk">
             <div id="mw-content-text"><div class="mw-parser-output">
               <p>${"Discussion about the lead paragraph. ".repeat(20)}</p>
             </div></div>
           </body>`,
    fixture: undefined,
  });

  assert.strictEqual(result, null);
});

test("extractWikipedia returns null when stripping leaves nothing", () => {
  const result = extract({
    html: `<body class="ns-0">
             <div id="mw-content-text"><div class="mw-parser-output">
               <div class="navbox">Nothing but furniture</div>
             </div></div>
           </body>`,
    fixture: undefined,
  });

  assert.strictEqual(result, null);
});
