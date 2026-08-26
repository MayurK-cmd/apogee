const DISCOURSE_MAX_POSTS = 80;
const DISCOURSE_MAX_POST_CHARS = 1500;

function isDiscoursePage() {
  const path = location.pathname;
  const isDiscourseUrl =
    /^\/t\/[^/]+\/\d+/i.test(path) || /^\/t\/\d+/i.test(path);

  const hasDiscourseMeta = Boolean(
    document.querySelector('meta[name="generator"][content*="Discourse" i]') ||
    document.querySelector(
      'meta[property="og:site_name"][content*="Discourse" i]',
    ),
  );

  const hasDiscourseDom = Boolean(
    document.querySelector(
      "#main-outlet, .topic-post, .post-stream, #topic-title",
    ),
  );

  return isDiscourseUrl || (hasDiscourseMeta && hasDiscourseDom);
}

function extractDiscourse() {
  if (!isDiscoursePage()) return null;

  const path = location.pathname;
  if (
    /^\/c\//i.test(path) ||
    /^\/tag\//i.test(path) ||
    /^\/u\//i.test(path) ||
    /^\/latest/i.test(path) ||
    /^\/top/i.test(path) ||
    /^\/unread/i.test(path) ||
    /^\/categories/i.test(path) ||
    /^\/search/i.test(path)
  ) {
    return null;
  }

  const titleEl = document.querySelector(
    "a.fancy-title, .fancy-title, #topic-title h1 a, #topic-title h1",
  );
  const titleText =
    titleEl?.innerText?.trim() || titleEl?.textContent?.trim() || "";

  if (!titleText) return null;

  const categoryEl = document.querySelector(".topic-category, .badge-wrapper");
  const categoryText =
    categoryEl?.innerText?.trim() || categoryEl?.textContent?.trim() || "";

  const postElements = Array.from(
    document.querySelectorAll(
      ".post-stream .topic-post, #main-outlet .topic-post, article.boxed, div[id^='post_']",
    ),
  ).filter(
    (el) => el && (typeof el.isConnected === "undefined" || el.isConnected),
  );

  if (postElements.length === 0) return null;

  const opEl = postElements[0];
  const opAuthorEl = opEl?.querySelector?.(
    ".username, .names .username, [itemprop='author'], .creator",
  );
  const opAuthor =
    opAuthorEl?.innerText?.trim() || opAuthorEl?.textContent?.trim() || "anon";

  const opBodyEl = opEl?.querySelector?.(".cooked, .post-body, .topic-body");
  const opText = opBodyEl
    ? (opBodyEl.innerText || opBodyEl.textContent || "").trim()
    : "";

  const replyElements = postElements.slice(1);

  const commentItems = replyElements
    .filter(
      (el) => el && (typeof el.isConnected === "undefined" || el.isConnected),
    )
    .map((el) => {
      const authorEl = el.querySelector?.(
        ".username, .names .username, [itemprop='author'], .creator",
      );
      const bodyEl = el.querySelector?.(".cooked, .post-body, .topic-body");
      const likesEl = el.querySelector?.(
        ".like-count, .post-retort, .actions .likes",
      );

      const authorName =
        authorEl?.innerText?.trim() || authorEl?.textContent?.trim() || "anon";
      const rawText = bodyEl
        ? bodyEl.innerText?.trim() || bodyEl.textContent?.trim() || ""
        : "";

      const likesText =
        likesEl?.innerText?.trim() || likesEl?.textContent?.trim() || "";
      const parsedScore = parseInt(likesText.replace(/[^0-9-]/g, ""), 10);
      const score = isNaN(parsedScore) ? undefined : parsedScore;

      return {
        depth: 0,
        author: authorName,
        text: threadTruncate(rawText, DISCOURSE_MAX_POST_CHARS),
        score,
      };
    });

  const nodes = buildThreadNodes(commentItems);
  const eligible = (n) => n.text;
  const comments = selectThreadComments(nodes, eligible, DISCOURSE_MAX_POSTS);

  let content = `Discourse topic\n\nTitle: ${titleText}\nAuthor: ${opAuthor}\n`;
  if (categoryText) content += `Category: ${categoryText}\n`;
  if (opText) content += `\nPost:\n${opText}\n`;

  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n(No replies yet.)\n`;

  return {
    type: "discourse",
    title: `Discourse: ${titleText}`,
    url: location.href,
    content: content.trim(),
  };
}

true;
