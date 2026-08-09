const WIKI_APPENDIX_IDS = new Set([
  "see_also",
  "notes",
  "footnotes",
  "explanatory_notes",
  "references",
  "citations",
  "sources",
  "bibliography",
  "works_cited",
  "further_reading",
  "external_links",
]);

const WIKI_STRIP = [
  ".mw-editsection",
  "sup.reference",
  "sup.mw-ref",
  ".reference",
  ".reflist",
  ".mw-references-wrap",
  ".navbox",
  ".vertical-navbox",
  ".hatnote",
  ".shortdescription",
  ".metadata",
  ".ambox",
  ".side-box",
  ".sistersitebox",
  ".portalbox",
  ".portal",
  ".mw-empty-elt",
  ".toc",
  "#toc",
  ".mw-jump-link",
  ".noprint",
  "table.infobox",
  "figure",
  ".thumb",
  ".gallery",
  "style",
  "script",
  "sup.noprint",
].join(",");

const WIKI_KEEP = "p, h2, h3, h4, ul, ol, dl, blockquote";

function wikiHeadingLevel(el) {
  return Number(el.tagName.slice(1)) || 2;
}

function wikiIsAppendixHeading(el) {
  const id = (el.getAttribute("id") || "").toLowerCase();
  if (WIKI_APPENDIX_IDS.has(id)) return true;
  const text = (el.textContent || "").trim().toLowerCase().replace(/\s+/g, "_");
  return WIKI_APPENDIX_IDS.has(text);
}

function extractWikipedia() {
  if (!document.body.classList.contains("ns-0")) return null;

  const root = document.querySelector("#mw-content-text .mw-parser-output");
  if (!root) return null;

  const work = root.cloneNode(true);
  work.querySelectorAll(WIKI_STRIP).forEach((el) => el.remove());

  const lines = [];
  let leadChars = 0;
  let sawHeading = false;

  for (const el of work.querySelectorAll(WIKI_KEEP)) {
    const tag = el.tagName.toLowerCase();

    if (tag === "h2" || tag === "h3" || tag === "h4") {
      if (wikiIsAppendixHeading(el)) break;
      const text = (el.textContent || "").trim();
      if (!text) continue;
      sawHeading = true;
      lines.push("\n" + "#".repeat(wikiHeadingLevel(el)) + " " + text);
      continue;
    }

    if (el.closest("ul, ol, dl") !== el && /^(ul|ol|dl)$/.test(tag)) continue;

    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(text);
    if (!sawHeading) leadChars += text.length + 1;
  }

  const content = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (content.length < 200) return null;

  return {
    type: "wikipedia",
    title: (
      document.querySelector("#firstHeading")?.textContent || document.title
    ).trim(),
    url: location.href,
    content,
    leadChars,
  };
}
