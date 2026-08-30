---
name: New site extractor
about: Propose (or claim) support for extracting a specific site
title: "Add a <site> extractor"
labels: extractor
---

**Which site?**
Name it, plus an example URL of the kind of page this should handle.

**What does Apogee do there today?**
Every site falls through to the generic Readability extractor unless one is
written for it. Say what that currently produces and why it isn't good enough:
missing comments, mangled structure, navigation furniture pulled into the text,
content behind a lazy-loaded SPA, and so on.

**Which pages should it handle, and which should it skip?**
An extractor has to return `null` for pages it doesn't specifically handle
(listing pages, profiles, search results) so those keep falling through to
Readability. List both sides.

- Handles:
- Returns `null` for:

**Is the content in the DOM, or in an API?**
Both patterns already exist to copy from:

- Server-rendered DOM, read it directly: `content/extractors/hackernews.js`
- Same-origin JSON the site already serves, `fetch` it:
  `content/extractors/reddit.js`

If it's a discussion site with a comment tree, `content/extractors/thread.js`
gives you the reply hierarchy, path notation, and selection for free.

**Anything unusual about the page?**
Infinite scroll, shadow DOM, content that only appears after interaction, login
walls, region differences. This is usually what decides whether an extractor is
an evening's work or a week's.

---

<!-- Keep this section, it's what "done" means. -->

**Definition of done**

- [ ] Extractor added under `content/extractors/`, registered in
      `content/content.js` and in the injection list in
      `lib/extract/pageExtraction.js`
- [ ] Returns `null` for the pages listed above
- [ ] A test under `tests/extractors/` with a trimmed, scrubbed HTML fixture.
      See [tests/extractors/README.md](../../apogee-extension/tests/extractors/README.md).
      No browser or model download needed for this part
- [ ] `npm run format:check`, `npm run lint`, `npm test`, `npm run build` all pass
- [ ] No new host permission (if the site needs one, say so in the PR: that
      means updating the manifest, README, PRIVACY.md and STORE-LISTING.md
      together)
