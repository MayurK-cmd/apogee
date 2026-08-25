function threadTruncate(text, max, { preserveLines = false } = {}) {
  const collapsed = preserveLines
    ? (text || "").replace(/[ \t]+\n/g, "\n")
    : (text || "").replace(/\s+/g, " ");
  const t = collapsed.trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

function buildThreadNodes(items) {
  const counters = [];
  const parents = [];

  for (const node of items) {
    const depth = node.depth;
    counters[depth] = (counters[depth] || 0) + 1;
    counters.length = depth + 1;
    parents.length = depth;

    node.parent = parents[depth - 1] || null;
    node.path = counters.join(".");
    node.directReplies = 0;
    node.subtreeSize = 0;
    if (node.parent) node.parent.directReplies++;
    parents[depth] = node;
  }

  for (const node of items) {
    for (let p = node.parent; p; p = p.parent) p.subtreeSize++;
  }
  return items;
}

function selectThreadComments(nodes, eligible, maxComments) {
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

const THREAD_COMMENTS_HEADER =
  "Comments (path [n.n] shows the reply tree; <replies> = direct replies; {downvotes}/(score) are engagement signals):";

function formatThreadComments(nodes) {
  const lines = [];
  for (const n of nodes) {
    let line = `[${n.path}]`;
    if (n.directReplies) line += ` <replies: ${n.directReplies}>`;
    if (n.downvotes) line += ` {downvotes: ${n.downvotes}}`;
    if (typeof n.score === "number") line += ` (score: ${n.score})`;
    if (n.accepted) line += ` [accepted]`;
    line += ` ${n.author}: ${n.text}`;
    lines.push(line);
  }
  return lines.join("\n");
}
