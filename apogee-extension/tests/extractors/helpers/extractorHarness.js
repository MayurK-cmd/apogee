// Runs the content-script extractors against saved HTML fixtures, in Node, with
// no browser and no model download. See tests/extractors/README.md for how to
// add one.
//
// The extractors aren't modules: the extension injects them as plain scripts
// that share one page global scope (see lib/extract/pageExtraction.js's file
// list), so `thread.js` declaring `buildThreadNodes` is what puts it in scope
// for `hackernews.js`. Reproducing that here means evaluating each file as a
// separate script in one shared `node:vm` context, which is exactly what
// chrome.scripting.executeScript does, rather than importing them. Function
// declarations and top-level const both persist across scripts in a context, so
// load order in `files` matters the same way it does in the injection list.
//
// The DOM comes from linkedom. It is not a browser: no layout, no CSS, so
// anything depending on computed styles or element geometry can't be covered
// here and needs manual verification in the extension.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const fixturesDir = join(here, "..", "fixtures");

/** Reads a file from tests/extractors/fixtures. */
export function readFixture(name) {
  return readFileSync(join(fixturesDir, name), "utf8");
}

/** Reads and JSON-parses a fixture, for extractors that fetch an API. */
export function readJsonFixture(name) {
  return JSON.parse(readFixture(name));
}

// An extractor reaching the network in a unit test is always a mistake: it
// makes the test slow, flaky, and dependent on a live third party. Failing
// loudly beats a real request going out, so the defaults throw with the name of
// the option to pass instead.
//
// Throwing alone isn't enough: several extractors treat a failed request as
// "this isn't a page I handle" and return null from their own catch (see
// reddit.js), which swallows the error and makes a forgotten stub look exactly
// like a deliberate null return. So it also rethrows from a macrotask, outside
// any extractor's try/catch, where the test runner sees an uncaught exception
// and fails the test that caused it. A silently passing test asserting `null`
// for the wrong reason is worse than no test at all.
function refuseNetwork(what, option) {
  return () => {
    const error = new Error(
      `This extractor called ${what}, but the test didn't stub it. ` +
        `Pass \`${option}\` to loadExtractors() with a fake response.`,
    );
    setImmediate(() => {
      throw error;
    });
    throw error;
  };
}

/**
 * Loads extractor scripts into a fresh DOM and returns the shared global scope
 * they declared themselves into, so a test can pull the extractor function off
 * it by name.
 *
 * @param {object}   options
 * @param {string[]} options.files    Paths under `content/`, in injection order,
 *                                    e.g. ["extractors/thread.js",
 *                                    "extractors/hackernews.js"].
 * @param {string}   options.url      The page URL the extractor sees as
 *                                    `location`. Extractors branch on this, so
 *                                    it has to be realistic.
 * @param {string}  [options.fixture] Fixture filename to use as the page HTML.
 * @param {string}  [options.html]    Inline HTML, as an alternative to `fixture`.
 * @param {Function}[options.fetch]   Stub for `fetch`. Required only if the
 *                                    extractor calls it.
 * @param {object}  [options.chrome]  Stub for the `chrome` API, e.g.
 *                                    `{ runtime: { sendMessage: async () => ({}) } }`.
 * @returns {object} The global scope, including every function the loaded files
 *                   declared (`extractHackerNews`, `extractReddit`, …).
 */
export function loadExtractors({
  files,
  url,
  fixture,
  html,
  fetch: fetchStub,
  chrome: chromeStub,
}) {
  if (!files?.length) throw new Error("loadExtractors needs at least one file");
  if (!url) throw new Error("loadExtractors needs a url");
  if (!fixture && html === undefined) {
    throw new Error("loadExtractors needs either `fixture` or `html`");
  }

  const source = fixture ? readFixture(fixture) : html;
  const { window, document } = parseHTML(source);

  // A URL stands in for Location: it carries href, origin, pathname, search,
  // and hostname, which is everything the extractors read off it.
  const location = new URL(url);
  for (const target of [window, document]) {
    try {
      Object.defineProperty(target, "location", {
        value: location,
        configurable: true,
      });
    } catch {
      // linkedom may expose location as a non-configurable accessor; the bare
      // `location` global below is what the extractors actually use.
    }
  }

  const sandbox = {
    window,
    document,
    location,
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    NodeFilter: window.NodeFilter,
    getComputedStyle: window.getComputedStyle?.bind(window),
    fetch: fetchStub || refuseNetwork("fetch()", "fetch"),
    chrome: chromeStub || {
      runtime: {
        sendMessage: refuseNetwork("chrome.runtime.sendMessage()", "chrome"),
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  for (const file of files) {
    const path = join(contentDir, file);
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  }

  return context;
}
