// Extractor for Reddit comment pages (reddit.com/r/<sub>/comments/<id>/...).
// Reddit's rendered DOM is a web-component/shadow-DOM SPA that lazy-loads
// comments on scroll, so scraping it is brittle and incomplete. Every thread,
// though, exposes a clean structured JSON at the same URL + ".json". Because
// this extractor runs inside the page's tab (via activeTab), that fetch is
// SAME-ORIGIN on reddit.com, no CORS, no host_permissions, no CSP changes
// (same pattern as the same-origin PDF fetch in lib/extract/pageExtraction.js).
// Falls back to the generic Readability extractor if the fetch fails.
//
// The comment tree is handed to the shared thread representation (thread.js) as
// a flat pre-order list, so Reddit gets the same path notation, reply counts,
// and branch-weighted selection as Hacker News, plus real per-comment scores,
// which HN can't provide.

const REDDIT_MAX_COMMENTS = 60;
const REDDIT_MAX_DEPTH = 8;
const REDDIT_MAX_COMMENT_CHARS = 1500;
// Generous: on a text post (r/AmItheAsshole, r/legaladvice, …) the body IS the
// content, so keep it whole and let the summarizer's map/reduce condense it,
// rather than hard-truncating the tail away. Only a pathologically long post
// hits this ceiling.
const REDDIT_MAX_SELFTEXT_CHARS = 12000;

// Flattens Reddit's nested comment listing into a pre-order (depth-first) list
// of thread items. "more" nodes (collapsed "load more comments" stubs) carry no
// text and are skipped. Deleted/removed bodies become empty-text items (dropped
// later by eligibility) but are still descended into, so a live reply under a
// deleted parent isn't lost.
function redditCollectItems(children, depth, items) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (!child || child.kind !== "t1" || !child.data) continue;
    const c = child.data;
    const body = (c.body || "").trim();
    const dead = !body || body === "[deleted]" || body === "[removed]";
    items.push({
      depth,
      author: c.author || "anon",
      score: typeof c.score === "number" ? c.score : undefined,
      text: dead ? "" : threadTruncate(body, REDDIT_MAX_COMMENT_CHARS),
    });
    if (depth < REDDIT_MAX_DEPTH && c.replies && c.replies.data) {
      redditCollectItems(c.replies.data.children, depth + 1, items);
    }
  }
}

async function extractReddit() {
  // Only comment permalinks have a discussion to summarize; subreddit and
  // listing pages fall through to the generic extractor (null return).
  if (!/\/comments\//.test(location.pathname)) return null;

  // Build the JSON endpoint from the current origin + path (same-origin).
  // raw_json=1 disables Reddit's HTML-entity encoding of body text; sort=top
  // and a generous limit/depth pull the most relevant slice of the tree.
  const base = `${location.origin}${location.pathname.replace(/\/+$/, "")}`;
  const jsonUrl = `${base}.json?raw_json=1&limit=200&depth=${REDDIT_MAX_DEPTH}&sort=top`;

  let data;
  try {
    // credentials omitted: the public JSON needs no auth, and this keeps the
    // read free of the user's session (no personalized ordering, no cookies).
    const res = await fetch(jsonUrl, {
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null; // network/parse failure → content.js falls back to generic
  }

  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) return null;

  const title = (post.title || document.title).trim();
  const subreddit = post.subreddit_name_prefixed || "";
  const author = post.author ? `u/${post.author}` : "";
  const score = typeof post.score === "number" ? `${post.score} points` : "";
  const numComments =
    typeof post.num_comments === "number"
      ? `${post.num_comments} comments`
      : "";
  const flair = post.link_flair_text ? `[${post.link_flair_text}]` : "";
  // Self text for text posts; outbound link for link posts.
  const selftext = threadTruncate(
    post.selftext || "",
    REDDIT_MAX_SELFTEXT_CHARS,
    {
      preserveLines: true,
    },
  );
  const externalUrl = post.is_self ? "" : post.url || "";

  const items = [];
  redditCollectItems(data?.[1]?.data?.children, 0, items);
  const nodes = buildThreadNodes(items);
  const eligible = (n) => n.text && n.depth <= REDDIT_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, REDDIT_MAX_COMMENTS);

  let content = `Reddit discussion\n\nTitle: ${title}\n`;
  const meta = [subreddit, author, score, numComments, flair]
    .filter(Boolean)
    .join(" | ");
  if (meta) content += `${meta}\n`;
  if (externalUrl) content += `Links to: ${externalUrl}\n`;
  if (selftext) content += `\nPost:\n${selftext}\n`;

  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n(No comments yet.)\n`;

  return {
    type: "reddit",
    title,
    url: location.href,
    content: content.trim(),
  };
}
