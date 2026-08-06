# Contributing to Apogee

Thanks for taking a look at Apogee. This project is a single package,
`apogee-extension/`, a Chrome/Edge/Dia/Firefox browser extension.

## Getting set up

```bash
cd apogee-extension
npm install
npm run dev     # watch mode, rebuilds dist/chrome and dist/firefox on save
```

Load `apogee-extension/dist/chrome` (or `dist/firefox`) as an unpacked/temporary
extension in your browser. See the main [README](README.md#install-the-extension)
for the exact steps per browser.

If you're working on the **Local Ollama** provider, you'll also need Ollama
installed and running; the extension reaches it directly with no `OLLAMA_ORIGINS`
setup (see [README's Advanced: Local Ollama Mode](README.md#advanced-local-ollama-mode)).

## Before opening a PR

Run these from `apogee-extension/` (or from the repo root, where they're
mirrored as `npm run lint` / `npm test` / `npm run build`):

```bash
npm run format:check   # prettier --check .
npm run lint           # eslint .
npm test               # node --test
npm run build           # builds both dist/chrome and dist/firefox
```

CI runs the same four checks on every push and pull request, a PR won't be
mergeable until they're green.

If `format:check` fails, run `npm run format` to auto-fix it.

## Code style

- No comments explaining _what_ code does, only _why_, when the reason isn't
  obvious from reading it (a workaround, a non-obvious constraint, a subtle
  invariant).
- Keep changes scoped: a bug fix shouldn't carry an unrelated refactor along
  with it.
- Prefer editing existing files/patterns already in the codebase over
  introducing a new abstraction for a one-off need.

## Commit messages

This repo doesn't enforce a strict format, but commit messages generally
follow a `type: summary` shape (`fix:`, `feat:`, `perf:`, `chore:`, `docs:`,
`style:`), matching what you'll see in `git log`.

## Privacy is the point

Apogee's core guarantee is that page content and generated
summaries/answers never leave your device except to your own local Ollama
instance over loopback. If a change would introduce a new outbound network
call, call that out explicitly in the PR description.

Permissions and network behaviour are described in four places, and they have
to agree, a claim that lives in one and not the others is exactly what store
reviewers catch:

- `apogee-extension/manifest.json`, the source of truth
- [Privacy & Permissions](README.md#privacy--permissions) in the README
- [PRIVACY.md](PRIVACY.md), the published policy the store listing links to
- `store-listing.md`, which carries a justification per permission

Adding, removing, or repurposing a permission or a host means editing all
four in the same PR.

## Reporting bugs / requesting features

Open an issue using the templates under `.github/ISSUE_TEMPLATE/`. Include
your browser + version, the extension version (`chrome://extensions`), and
whether you're using WebLLM or Local Ollama mode.
