// Shared discussion-thread representation, used by the Hacker News and Reddit
// extractors (github.js reuses only threadTruncate). Injected BEFORE them (see
// lib/extract/pageExtraction.js), so its helpers are in scope as globals, the
// same load-order pattern Readability.js/generic.js already rely on.
//
// The "algo" (mirroring hncompanion.com/how-it-works, generalized so any source
// can feed it): take a comment thread as a flat, pre-order (depth-first) list of
//   { depth, author, text, score?, downvotes? }
// items, rebuild the reply hierarchy, tag each comment with a path ([1], [1.1],
// …), its direct-reply count and subtree size, drop dead/over-limit noise, and,
// when the thread is larger than the cap, keep the most active branches
// (largest subtree) plus their ancestors so the numbering stays coherent. The
// path notation hands the model structure, and <replies>/{downvotes}/(score)
// give it the engagement signals to weight and attribute what was said.
//
// HN and Reddit differ only in what they can supply: HN has no per-comment score
// (never exposed publicly) but a downvote proxy from its fade classes; Reddit
// has real scores but no downvote counts. The unified line format shows only the
// fields a given source actually provides.

// Collapses whitespace and truncates. Comment bodies must be single-line (one
// line per comment in the path notation), so the default collapses newlines;
// pass preserveLines for block text like a post body.
function threadTruncate(text, max, { preserveLines = false } = {}) {
  const collapsed = preserveLines
    ? (text || "").replace(/[ \t]+\n/g, "\n")
    : (text || "").replace(/\s+/g, " ");
  const t = collapsed.trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

// Rebuilds parent links, paths, and reply/subtree counts from a pre-order list
// of { depth, ... } items (depth 0 = top level). Mutates items in place (adds
// parent/path/directReplies/subtreeSize) and returns them as the node list.
// directReplies here counts every child; selectThreadComments recounts it over
// eligible children once it knows which ones are real comments.
function buildThreadNodes(items) {
  const counters = []; // counters[d] = running index of comments at depth d
  const parents = []; // parents[d] = the node currently open at depth d

  for (const node of items) {
    const depth = node.depth;
    counters[depth] = (counters[depth] || 0) + 1;
    counters.length = depth + 1; // reset deeper counters so a new branch restarts
    parents.length = depth; // drop parents deeper than this row

    node.parent = parents[depth - 1] || null;
    node.path = counters.join(".");
    node.directReplies = 0;
    node.subtreeSize = 0;
    if (node.parent) node.parent.directReplies++;
    parents[depth] = node;
  }

  // Subtree sizes: each node contributes 1 to every ancestor above it.
  for (const node of items) {
    for (let p = node.parent; p; p = p.parent) p.subtreeSize++;
  }
  return items;
}

// Keeps the comments `eligible(node)` accepts (non-dead, within downvote/depth
// limits), branch-weighted down to maxComments when the thread is too big:
// largest subtree first, then every *eligible* ancestor of a kept node
// re-added so a kept deep reply keeps its parent context. Ineligible (dead/
// removed) ancestors stay dropped, paths are absolute, so the numbering reads
// coherently regardless. Returns survivors in original pre-order sequence.
function selectThreadComments(nodes, eligible, maxComments) {
  // buildThreadNodes counts every child, because it runs before anyone knows
  // what counts as a real comment. Recount over eligible children only, now
  // that we do: a `[deleted]` stub or a flagged-to-oblivion rant is not a reply
  // anyone would count, and reporting <replies: 2> above a single visible reply
  // invites the model to describe a second one that was never in its context.
  //
  // Deliberately eligibility, not the maxComments selection below: a reply
  // dropped for capacity is still a real reply, and on exactly the huge threads
  // where that happens, the reply count is the signal telling the model which
  // comments drew the argument.
  for (const node of nodes) node.directReplies = 0;
  for (const node of nodes) {
    if (eligible(node) && node.parent) node.parent.directReplies++;
  }

  const survivors = nodes.filter(eligible);
  if (survivors.length <= maxComments) return survivors;

  const ranked = [...survivors].sort(
    (a, b) => b.subtreeSize - a.subtreeSize || a.depth - b.depth,
  );
  const keep = new Set(ranked.slice(0, maxComments));
  for (const n of [...keep]) {
    for (let p = n.parent; p; p = p.parent) keep.add(p);
  }
  return nodes.filter((n) => keep.has(n) && eligible(n));
}

// Header that introduces the path notation to the summarizer's discussion
// prompt (see buildDiscussionPrompt in lib/summarize/prompts.js).
const THREAD_COMMENTS_HEADER =
  "Comments (path [n.n] shows the reply tree; <replies> = direct replies; {downvotes}/(score) are engagement signals):";

// Renders selected nodes as one path-notation line each, showing only the
// metadata fields present on the node.
function formatThreadComments(nodes) {
  const lines = [];
  for (const n of nodes) {
    let line = `[${n.path}]`;
    if (n.directReplies) line += ` <replies: ${n.directReplies}>`;
    if (n.downvotes) line += ` {downvotes: ${n.downvotes}}`;
    if (typeof n.score === "number") line += ` (score: ${n.score})`;
    line += ` ${n.author}: ${n.text}`;
    lines.push(line);
  }
  return lines.join("\n");
}
