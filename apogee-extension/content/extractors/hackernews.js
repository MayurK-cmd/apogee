const HN_MAX_COMMENTS = 80;
const HN_MAX_DEPTH = 8;
const HN_MAX_COMMENT_CHARS = 1500;
const HN_DOWNVOTE_LIMIT = 4;

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

function hnCommentText(el) {
  const visible = el.innerText.trim();
  return visible || (el.textContent || "").trim();
}

function hnDownvotes(commtextEl) {
  for (let i = HN_FADE_CLASSES.length - 1; i >= 1; i--) {
    if (commtextEl.classList.contains(HN_FADE_CLASSES[i])) return i;
  }
  return 0;
}

function hnCommentDepth(row) {
  const ind = row.querySelector("td.ind");
  if (!ind) return 0;
  const attr = ind.getAttribute("indent");
  if (attr !== null) return Number(attr) || 0;
  const img = ind.querySelector("img");
  const width = Number(img?.getAttribute("width") || 0);
  return Math.round(width / 40) || 0;
}

function hnCommentItems(rows) {
  const elements = Array.from(rows).filter(
    (row) => row && (typeof row.isConnected === "undefined" || row.isConnected),
  );
  return elements.map((row) => {
    const bodyEl = row.querySelector?.(".commtext");
    const authorEl = row.querySelector?.(".hnuser");
    return {
      depth: hnCommentDepth(row),
      author:
        authorEl?.innerText?.trim() || authorEl?.textContent?.trim() || "anon",
      text: bodyEl
        ? threadTruncate(hnCommentText(bodyEl), HN_MAX_COMMENT_CHARS)
        : "",
      downvotes: bodyEl ? hnDownvotes(bodyEl) : 0,
    };
  });
}

function extractHackerNews() {
  if (location.pathname !== "/item") return null;

  const fatitem = document.querySelector(".fatitem");
  if (!fatitem) return null;

  const titleEl =
    fatitem.querySelector(".titleline a") ||
    fatitem.querySelector(".titleline");
  const title = (
    titleEl?.innerText ||
    titleEl?.textContent ||
    document.title
  ).trim();

  const linkHref =
    fatitem.querySelector(".titleline a")?.getAttribute("href") || "";
  const isExternalLink = /^https?:/i.test(linkHref);
  const domain = fatitem.querySelector(".sitestr")?.innerText?.trim() || "";

  const points = fatitem.querySelector(".score")?.innerText?.trim() || "";
  const author = fatitem.querySelector(".hnuser")?.innerText?.trim() || "";
  const age = fatitem.querySelector(".age")?.innerText?.trim() || "";

  const storyText = fatitem.querySelector(".toptext")?.innerText?.trim() || "";

  const commentRows = Array.from(
    document.querySelectorAll("tr.athing.comtr"),
  ).filter(
    (row) => row && (typeof row.isConnected === "undefined" || row.isConnected),
  );
  const nodes = buildThreadNodes(hnCommentItems(commentRows));
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
