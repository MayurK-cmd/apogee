const GH_MAX_COMMENTS = 40;
const GH_MAX_COMMENT_CHARS = 4000;
const GH_MAX_README_CHARS = 12000;
const GH_MAX_DIFF_CHARS = 30000;

function ghTruncate(text, max) {
  return threadTruncate(text, max, { preserveLines: true });
}

function ghReadme() {
  const el =
    document.querySelector("#readme article.markdown-body") ||
    document.querySelector("#readme .markdown-body");
  return el ? el.innerText.trim() : "";
}

function ghConversation() {
  let blocks = Array.from(document.querySelectorAll(".timeline-comment"));
  if (!blocks.length) {
    blocks = Array.from(
      document.querySelectorAll('[data-testid="comment-viewer-outer-box"]'),
    );
  }
  if (!blocks.length) {
    blocks = Array.from(document.querySelectorAll(".markdown-body"));
  }

  const out = [];
  const seen = new Set();
  for (const block of blocks) {
    if (
      !block ||
      (typeof block.isConnected !== "undefined" && !block.isConnected)
    )
      continue;
    if (out.length >= GH_MAX_COMMENTS) break;
    const bodyEl =
      block.querySelector?.(".comment-body, .markdown-body") || block;
    const text = (bodyEl?.innerText || bodyEl?.textContent || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const author =
      block
        .querySelector?.(
          '.author, a[data-testid="avatar-link"], .ActionListItem-label',
        )
        ?.innerText?.trim() || "";
    out.push({ author, text: ghTruncate(text, GH_MAX_COMMENT_CHARS) });
  }
  return out;
}

async function ghFetchDiff(owner, repo, number) {
  const api = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
  try {
    const res = await fetch(api, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github.diff" },
    });
    if (!res.ok) return "";
    const text = await res.text();
    if (!/^diff --git|\n@@ /.test(text)) return "";
    return ghTruncate(text, GH_MAX_DIFF_CHARS);
  } catch {
    return "";
  }
}

async function extractGitHub() {
  const parts = location.pathname.split("/").filter(Boolean);
  const [owner, repo, section, number] = parts;
  if (!owner || !repo) return null;
  const repoSlug = `${owner}/${repo}`;

  const isPull = section === "pull" && /^\d+$/.test(number || "");
  const isIssue = section === "issues" && /^\d+$/.test(number || "");
  if (isPull || isIssue) {
    const kind = isPull ? "pull request" : "issue";
    const title =
      document
        .querySelector(
          '.js-issue-title, bdi.js-issue-title, [data-testid="issue-title"]',
        )
        ?.innerText.trim() ||
      document.querySelector("h1")?.innerText.trim() ||
      document.title;
    const state =
      document
        .querySelector('.State, [data-testid="header-state"]')
        ?.innerText.trim() || "";
    const comments = ghConversation();

    let content = `GitHub ${kind} in ${repoSlug} (#${number})\n\nTitle: ${title}\n`;
    if (state) content += `State: ${state}\n`;

    if (comments.length) {
      const [first, ...rest] = comments;
      content += `\nDescription${first.author ? ` (by ${first.author})` : ""}:\n${first.text}\n`;
      if (rest.length) {
        content += `\nComments:\n`;
        for (const c of rest) {
          content += `- ${c.author ? `${c.author}: ` : ""}${c.text}\n`;
        }
      }
    }

    if (isPull) {
      const diff = await ghFetchDiff(owner, repo, number);
      content += diff
        ? `\nCode changes (unified diff):\n${diff}\n`
        : `\n(Diff unavailable.)\n`;
    }

    return {
      type: "github",
      title,
      url: location.href,
      content: content.trim(),
    };
  }

  if (parts.length === 2) {
    const readme = ghReadme();
    if (!readme) return null;
    const description =
      document
        .querySelector('meta[property="og:description"]')
        ?.content?.trim() || "";
    const topics = Array.from(document.querySelectorAll("a.topic-tag"))
      .map((t) => t.innerText.trim())
      .filter(Boolean);

    let content = `GitHub repository: ${repoSlug}\n`;
    if (description) content += `\nDescription: ${description}\n`;
    if (topics.length) content += `Topics: ${topics.join(", ")}\n`;
    content += `\nREADME:\n${ghTruncate(readme, GH_MAX_README_CHARS)}\n`;

    return {
      type: "github",
      title: repoSlug,
      url: location.href,
      content: content.trim(),
    };
  }

  return null;
}
