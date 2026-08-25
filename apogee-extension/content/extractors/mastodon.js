const MASTODON_MAX_COMMENTS = 80;
const MASTODON_MAX_DEPTH = 8;
const MASTODON_MAX_COMMENT_CHARS = 1500;

function isMastodonPage() {
  const path = location.pathname;
  const isMastodonUrl =
    /^\/@[^/]+\/\d+/i.test(path) ||
    /^\/users\/[^/]+\/statuses\/\d+/i.test(path) ||
    /^\/web\/statuses\/\d+/i.test(path) ||
    /^\/deck\/@[^/]+\/\d+/i.test(path);

  const hasMastodonMeta = Boolean(
    document.querySelector('meta[name="generator"][content*="Mastodon" i]') ||
    document.querySelector(
      'meta[property="og:site_name"][content*="Mastodon" i]',
    ),
  );

  const hasMastodonDom = Boolean(
    document.querySelector(
      ".detailed-status, .detailed-status__wrapper, article.status, .status__content",
    ),
  );

  return isMastodonUrl || (hasMastodonMeta && hasMastodonDom);
}

function mastodonCommentDepth(el, rootEl) {
  const indentAttr =
    el.getAttribute("data-depth") || el.getAttribute("data-indent");
  if (indentAttr !== null) {
    const parsed = parseInt(indentAttr, 10);
    if (!isNaN(parsed)) return parsed;
  }

  let depth = 0;
  let p = el.parentElement;
  while (p && p !== rootEl && p !== document.body) {
    if (
      p.classList.contains("status__wrapper") ||
      p.classList.contains("conversation-thread") ||
      p.tagName === "ARTICLE" ||
      p.tagName === "LI"
    ) {
      depth++;
    }
    p = p.parentElement;
  }
  return Math.max(0, depth - 1);
}

function mastodonCommentItems(commentElements, mainStatusEl) {
  return Array.from(commentElements, (el) => {
    const authorEl =
      el.querySelector(".display-name, .account__display-name, .u-author") ||
      el.querySelector(".status__display-name");
    const bodyEl =
      el.querySelector(
        ".status__content__text, .status__content, .e-content",
      ) || el.querySelector(".status__content");

    const authorName =
      authorEl
        ?.querySelector("strong, .display-name__html")
        ?.innerText?.trim() ||
      authorEl?.innerText?.trim() ||
      "anon";
    const authorHandle =
      authorEl
        ?.querySelector("span, .account__discreet, .p-nickname")
        ?.innerText?.trim() || "";
    const fullAuthor =
      authorHandle && !authorName.includes(authorHandle)
        ? `${authorName} (${authorHandle})`
        : authorName;

    const rawText = bodyEl
      ? bodyEl.innerText?.trim() || bodyEl.textContent?.trim() || ""
      : "";

    return {
      depth: mastodonCommentDepth(
        el,
        mainStatusEl?.parentElement || document.body,
      ),
      author: fullAuthor || "anon",
      text: threadTruncate(rawText, MASTODON_MAX_COMMENT_CHARS),
    };
  });
}

function extractMastodon() {
  if (!isMastodonPage()) return null;

  const mainStatus =
    document.querySelector(
      ".detailed-status, .detailed-status__wrapper, article.status.detailed, .status.detailed",
    ) ||
    document.querySelector(".status__wrapper.detailed, .single-status") ||
    document.querySelector("article.status, .status");

  if (!mainStatus) return null;

  const authorEl =
    mainStatus.querySelector(
      ".detailed-status__display-name, .display-name, .account__display-name, .u-author",
    ) || mainStatus.querySelector(".status__display-name");
  const authorName =
    authorEl?.querySelector("strong, .display-name__html")?.innerText?.trim() ||
    authorEl?.innerText?.trim() ||
    "anon";
  const authorHandle =
    authorEl
      ?.querySelector("span, .account__discreet, .p-nickname")
      ?.innerText?.trim() || "";
  const fullAuthor =
    authorHandle && !authorName.includes(authorHandle)
      ? `${authorName} (${authorHandle})`
      : authorName;

  const bodyEl =
    mainStatus.querySelector(
      ".detailed-status__content, .status__content__text, .status__content, .e-content",
    ) || mainStatus.querySelector(".status__content");
  const postText = bodyEl
    ? (bodyEl.innerText || bodyEl.textContent || "").trim()
    : "";

  if (!postText) return null;

  const reblogsEl = mainStatus.querySelector(
    ".detailed-status__reblogs, [aria-label*='boost' i], [aria-label*='reblog' i]",
  );
  const favsEl = mainStatus.querySelector(
    ".detailed-status__favorites, [aria-label*='favorite' i]",
  );
  const reblogs = reblogsEl?.innerText?.trim() || "";
  const favs = favsEl?.innerText?.trim() || "";

  const title = `Mastodon post by ${fullAuthor}`;

  const candidateStatuses = Array.from(
    document.querySelectorAll(
      ".activity-stream article.status, .activity-stream .status, .thread article.status, .thread .status, article.status, .status",
    ),
  );

  const commentElements = candidateStatuses.filter((el) => {
    if (el === mainStatus || mainStatus.contains(el)) return false;
    if (
      el.classList.contains("status__wrapper") &&
      el.querySelector(".status")
    ) {
      return false;
    }
    return true;
  });

  const nodes = buildThreadNodes(
    mastodonCommentItems(commentElements, mainStatus),
  );
  const eligible = (n) => n.text && n.depth <= MASTODON_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, MASTODON_MAX_COMMENTS);

  let content = `Mastodon discussion\n\nTitle: ${title}\nAuthor: ${fullAuthor}\n`;
  const engagement = [
    reblogs && `${reblogs} boosts`,
    favs && `${favs} favorites`,
  ]
    .filter(Boolean)
    .join(" | ");
  if (engagement) content += `Engagement: ${engagement}\n`;
  content += `\nPost:\n${postText}\n`;

  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n(No comments yet.)\n`;

  return {
    type: "mastodon",
    title,
    url: location.href,
    content: content.trim(),
  };
}
