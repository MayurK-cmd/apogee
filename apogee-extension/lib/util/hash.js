// Two hashes with deliberately different jobs.
//
// sha256Hex is the one used for anything that reaches disk: storage keys
// derived from a URL (see pageCache.js's hashUrl). cyrb53's 53 bits are
// trivially brute-forced against a candidate URL list, so a local attacker
// could confirm which pages had been summarized just by reading the extension's
// storage. A truncated SHA-256 makes that infeasible while keeping keys short.
//
// cyrb53 stays for the in-memory-only case: rag.js keys its per-page embedding
// index by the content text itself, which never leaves the process, and that
// path wants a synchronous hash over a large string on every retrieval.

// First 128 bits of SHA-256, hex-encoded. 32 chars keeps storage keys readable
// while leaving preimage search far out of reach.
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// cyrb53, a fast non-cryptographic 53-bit string hash. Wide enough to avoid
// collisions in the small bounded caches that use it, but not a privacy
// boundary; see sha256Hex above for anything persisted.
export function cyrb53(str) {
  // Coerce instead of throwing on a nullish input: hashUrl(tab.url) can see
  // `undefined` when a popup opens without an activeTab grant (e.g. via
  // chrome.action.openPopup() from a notification), and a throw there used
  // to silently dump the whole view-restore path onto the home view.
  str = String(str ?? "");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
