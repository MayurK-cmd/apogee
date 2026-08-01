// Extractor for GitHub. Handles three page kinds, each a concrete win:
//   - repo root (github.com/<owner>/<repo>)      → rendered README + About
//   - issue     (.../issues/<n>)                 → title + body + comments
//   - pull req  (.../pull/<n>)                   → title + body + comments + diff
// README and conversation text come straight from the rendered DOM. For a PR
// we additionally pull the unified diff from api.github.com (see ghFetchDiff
// for why that endpoint rather than the "<pull-url>.diff" one), the diff is
// what makes "summarize this PR" genuinely useful rather than just restating
// the title, and it needs no host_permissions. Any unrecognized path (code
// browsing, search, ...) returns null so content.js falls back to generic.

const GH_MAX_COMMENTS = 40;
const GH_MAX_COMMENT_CHARS = 4000;
const GH_MAX_README_CHARS = 12000;
const GH_MAX_DIFF_CHARS = 30000;

// GitHub's issue/PR conversation is a linear list, not a voted reply tree, so
// it doesn't use the path-notation algo, only the shared truncation helper
// (thread.js), keeping line breaks in the multi-line bodies and diffs.
function ghTruncate(text, max) {
  return threadTruncate(text, max, { preserveLines: true });
}

// The rendered README lives in a `.markdown-body` inside the #readme block on a
// repo root page.
function ghReadme() {
  const el =
    document.querySelector("#readme article.markdown-body") ||
    document.querySelector("#readme .markdown-body");
  return el ? el.innerText.trim() : "";
}

// Issue/PR conversation. On PR pages (still the Rails view) each comment is a
// `.timeline-comment` wrapping an author link and a `.comment-body`; the first
// is the description, the rest are replies. The newer React issues UI drops
// those classes, so we fall back to `[data-testid="comment-viewer-outer-box"]`
// and, failing that, bare `.markdown-body` blocks. GitHub lazy-loads long
// threads on scroll, so this captures whatever has rendered, capped for tokens.
function ghConversation() {
  let blocks = document.querySelectorAll(".timeline-comment");
  if (!blocks.length) {
    blocks = document.querySelectorAll(
      '[data-testid="comment-viewer-outer-box"]',
    );
  }
  if (!blocks.length) blocks = document.querySelectorAll(".markdown-body");

  const out = [];
  const seen = new Set();
  for (const block of blocks) {
    if (out.length >= GH_MAX_COMMENTS) break;
    const bodyEl =
      block.querySelector(".comment-body, .markdown-body") || block;
    const text = bodyEl.innerText.trim();
    if (!text || seen.has(text)) continue; // skip empties and de-dupe overlaps
    seen.add(text);
    const author =
      block
        .querySelector(
          '.author, a[data-testid="avatar-link"], .ActionListItem-label',
        )
        ?.innerText.trim() || "";
    out.push({ author, text: ghTruncate(text, GH_MAX_COMMENT_CHARS) });
  }
  return out;
}

// Fetches the raw unified diff for a PR via the GitHub REST API's diff media
// type. The obvious "<pull-url>.diff" URL can't be used from here: it
// 302-redirects to patch-diff.githubusercontent.com, which sends no CORS
// headers, so the browser blocks the content script from reading the response.
// api.github.com instead returns the diff directly with
// `Access-Control-Allow-Origin: *`, so a plain cross-origin fetch can read it
// with no host_permissions (content-script fetches are exempt from the host
// page's CSP). Best-effort: unauthenticated API calls are rate-limited (60/hr
// per IP) and private PRs 404 without a token, so any non-OK response, or a
// body that isn't actually a diff, just yields "" and the summary proceeds on
// the conversation alone.
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

  // Pull request or issue conversation.
  const isPull = section === "pull" && /^\d+$/.test(number || "");
  const isIssue = section === "issues" && /^\d+$/.test(number || "");
  if (isPull || isIssue) {
    const kind = isPull ? "pull request" : "issue";
    // `.js-issue-title` is the Rails PR view; `[data-testid="issue-title"]` and
    // a bare `h1` cover the newer React issues UI.
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
      // First timeline comment is the description; label it distinctly.
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

  // Repo root: README + description. (Deeper code-browsing paths, /tree, /blob,
  // /commits, gists, have no README here and fall through to generic.)
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
