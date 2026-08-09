export function formatSummaryAsMarkdown({ title, url, summary }) {
  const heading = title ? `# ${title}` : "# Summary";
  const parts = [heading];
  if (url) parts.push(`Source: ${url}`);
  parts.push(summary || "");
  return parts.join("\n\n").trim() + "\n";
}
