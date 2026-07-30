// Extractor for Hacker News item pages (news.ycombinator.com/item?id=...).
// Pure DOM read, no network: HN server-renders the entire thread as classic
// table markup on page load (no lazy-loading, no SPA navigation), so the story
// and its full comment tree are already present.
//
// The comment tree is handed to the shared thread representation (thread.js) as
// a flat pre-order list — the DOM order of comment rows already IS depth-first
// pre-order — which turns it into the path notation, reply/branch metadata, and
// branch-weighted selection described there. HN's only source-specific quirks
// live here: reading indent depth out of the table markup, and deriving a
// downvote level from HN's comment-fade CSS classes (it never exposes numeric
// comment scores or downvotes any other way).

const HN_MAX_COMMENTS = 80;
const HN_MAX_DEPTH = 8;
const HN_MAX_COMMENT_CHARS = 1500;
// HN Companion excludes comments with more than 4 downvotes as noise; match it.
const HN_DOWNVOTE_LIMIT = 4;

// HN fades a comment's text the more it's been downvoted, via an ordered set of
// colour classes on `.commtext` (see HN's news.css). The index into this list
// is effectively the downvote count: c00 = not downvoted, cdd = greyed out.
const HN_FADE_CLASSES = [
  "c00",
  "c5a",
  "c73",
  "c82",
  "c88",
  "c9c",
  "cae",
  "cbe",
  "cca",
  "cdd",
];

// Comment body text. innerText honors CSS visibility, so a user-collapsed
// subtree (display:none) returns "" through it; fall back to textContent so
// collapsed comments still contribute their text. innerText is preferred when
// available because it preserves the paragraph breaks HN renders as <p>.
function hnCommentText(el) {
  const visible = el.innerText.trim();
  return visible || (el.textContent || "").trim();
}

// Downvote level 0-9 from the `.commtext.cXX` fade class (see HN_FADE_CLASSES).
function hnDownvotes(commtextEl) {
  for (let i = HN_FADE_CLASSES.length - 1; i >= 1; i--) {
    if (commtextEl.classList.contains(HN_FADE_CLASSES[i])) return i;
  }
  return 0;
}

// Indent depth of a comment row. Modern HN encodes it as an `indent` attribute
// on the spacer cell; older markup only has a spacer <img> whose width is
// depth * 40px. Read the attribute first, fall back to the image width.
function hnCommentDepth(row) {
  const ind = row.querySelector("td.ind");
  if (!ind) return 0;
  const attr = ind.getAttribute("indent");
  if (attr !== null) return Number(attr) || 0;
  const img = ind.querySelector("img");
  const width = Number(img?.getAttribute("width") || 0);
  return Math.round(width / 40) || 0;
}

// One pre-order item per comment row, in the shape thread.js expects. Dead/
// flagged comments (no `.commtext`) keep their tree slot with empty text so the
// paths and reply counts stay correct, and are dropped later by the eligibility
// filter.
function hnCommentItems(rows) {
  return Array.from(rows, (row) => {
    const bodyEl = row.querySelector(".commtext");
    return {
      depth: hnCommentDepth(row),
      author: row.querySelector(".hnuser")?.innerText.trim() || "anon",
      text: bodyEl
        ? threadTruncate(hnCommentText(bodyEl), HN_MAX_COMMENT_CHARS)
        : "",
      downvotes: bodyEl ? hnDownvotes(bodyEl) : 0,
    };
  });
}

function extractHackerNews() {
  // Only item (thread) pages carry a discussion; anything else (front page,
  // /newest, user pages) is a link list better handled by the generic
  // extractor. Returning null tells content.js to fall through to it.
  if (location.pathname !== "/item") return null;

  const fatitem = document.querySelector(".fatitem");
  if (!fatitem) return null;

  const titleEl =
    fatitem.querySelector(".titleline a") ||
    fatitem.querySelector(".titleline");
  const title = (titleEl?.innerText || document.title).trim();

  // Outbound link for a link post, and its domain for context.
  const linkHref =
    fatitem.querySelector(".titleline a")?.getAttribute("href") || "";
  const isExternalLink = /^https?:/i.test(linkHref);
  const domain = fatitem.querySelector(".sitestr")?.innerText.trim() || "";

  const points = fatitem.querySelector(".score")?.innerText.trim() || "";
  const author = fatitem.querySelector(".hnuser")?.innerText.trim() || "";
  const age = fatitem.querySelector(".age")?.innerText.trim() || "";

  // Self/text posts (Ask HN, Show HN with a body, poll intros) put their body
  // in a `.toptext` block inside the fatitem; link posts have none.
  const storyText = fatitem.querySelector(".toptext")?.innerText.trim() || "";

  const nodes = buildThreadNodes(
    hnCommentItems(document.querySelectorAll("tr.athing.comtr")),
  );
  const eligible = (n) =>
    n.text && n.downvotes <= HN_DOWNVOTE_LIMIT && n.depth <= HN_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, HN_MAX_COMMENTS);

  let content = `Hacker News discussion\n\nTitle: ${title}\n`;
  if (isExternalLink) content += `Links to: ${domain || linkHref}\n`;
  const meta = [points, author && `by ${author}`, age]
    .filter(Boolean)
    .join(" | ");
  if (meta) content += `${meta}\n`;
  if (storyText) content += `\nPost:\n${storyText}\n`;

  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n(No comments yet.)\n`;

  return {
    type: "hackernews",
    title,
    url: location.href,
    content: content.trim(),
  };
}
