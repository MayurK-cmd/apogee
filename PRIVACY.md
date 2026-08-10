# Apogee Privacy Policy

_Last updated: 2026-08-01_

Apogee is a private, in-browser AI assistant. It is designed so that the content you summarize or ask questions about is processed **entirely on your own device** and is **never sent to us or to any third-party server**. We do not operate any backend, we have no servers that receive your data, and we collect no analytics or telemetry of any kind.

## What we collect

**Nothing.** Apogee has no account system, no sign-in, and no server. We do not collect, transmit, sell, or share any user data.

- **Page content** (article text, YouTube and Bilibili transcripts, PDF text) that you ask Apogee to summarize or answer questions about is read from the tab you are actively viewing, processed locally by an AI model running on your device, and then discarded. It is never uploaded.
- **Local summary cache.** So that reopening a summary is instant and the same page is not re-processed needlessly, the summaries you generate (and, for plain articles and web pages only, the extracted page text) are cached in your browser's local extension storage. This data **stays on your device**, is keyed by a one-way hash of the page URL (the raw URL, which can contain session tokens, is not stored), and is evicted automatically over time. Content from YouTube, Bilibili, Gmail, Reddit, Hacker News, and GitHub pages is **not** cached. Clearing the extension's data (or the browser's site data for the extension) removes it.
- **Your settings** (chosen AI provider and model, summary format, and other preferences) are stored locally in your browser via the extension storage API. They stay on your device.

## Network connections Apogee makes

Apogee is offline-first, but a few features require specific, limited network connections. None of them transmit your page content or summaries to a third party.

1. **Model weight downloads (first run).** The first time you use an in-browser model, Apogee downloads the model's weight files from Hugging Face (`huggingface.co` and related hosts) and caches them locally. This is a one-time download of the model itself; no information about the pages you visit is included. As with any file download, Hugging Face sees your IP address and which model you fetched, and nothing more. After caching, in-browser AI runs fully offline. Model weight files are not cryptographically pinned, but they are loaded only as data inside the browser's sandboxed WebAssembly/WebGPU runtime: a model cannot execute code on your machine or read your data; at worst a tampered model could produce a lower-quality summary.

2. **Local Ollama (optional).** If you opt into Local Ollama mode, Apogee connects to an Ollama instance running on your own machine at `http://127.0.0.1` or `http://localhost`. This traffic stays on your device and never leaves it.

3. **SponsorBlock (YouTube only).** When summarizing a YouTube video, Apogee queries the community SponsorBlock API (`sponsor.ajay.app`) for sponsor-segment timings so it can skip sponsor reads and self-promotion when summarizing the transcript. The full video ID is never sent: Apogee sends only the first four characters of its SHA-256 hash, a prefix shared by many videos, and filters the returned segments locally (the same k-anonymity scheme the official SponsorBlock clients use). SponsorBlock therefore sees your IP address and that a YouTube summary is happening, but not which video. This is Apogee's only non-model third-party request, and you can turn it off under **Settings**, in the **Privacy** section, via **"Stay fully local (don't contact SponsorBlock)"**. When it's disabled, Apogee makes no request to SponsorBlock at all. Whether it's off, a video has no SponsorBlock data, or the request fails, Apogee falls back to a local, network-free phrase heuristic instead.

4. **Fetching the content of the page you are summarizing.** For a few sites, Apogee reads the material to summarize from that site's own public endpoint rather than only scraping the rendered page: the caption/transcript track for a YouTube video (from `youtube.com` / `googlevideo.com`), a Reddit thread's public JSON (from `reddit.com`, the same site you are on), and a GitHub pull request's diff (from GitHub's public API, `api.github.com`). These requests are sent **without your cookies or login session**, go to the same service whose page you are already viewing, and carry no information about your other browsing. The fetched content is summarized on your device and never uploaded anywhere else.

5. **Bilibili subtitles.** On a Bilibili video, Apogee fetches that video's subtitle track from Bilibili's own endpoints (`api.bilibili.com` and the `hdslb.com` subtitle CDN, the same service whose page you are viewing). Unlike the cookie-less fetches above, this one **is sent with your Bilibili cookies**, because Bilibili only exposes subtitle URLs to a logged-in session; the request carries only the video's own IDs, no information about your other browsing. The subtitles are summarized on your device and never uploaded anywhere else. When a video has no subtitles (or the request fails), Apogee falls back to summarizing the video's description alone.

We do not control Hugging Face, SponsorBlock, YouTube, Bilibili, Reddit, or GitHub; their own privacy policies govern the requests described above.

## Diagnostics you choose to share

Recording engine logs is off by default. When you turn it on, **Copy diagnostics as Markdown** in Settings copies a report you can paste into a bug report. Nothing is sent anywhere: it goes to your clipboard, and only when you press the button.

That report contains your extension version, browser user agent, whether WebGPU is available, and your settings. Two settings are deliberately reported as a shape rather than a value, because a bug report is usually public:

- **Custom instructions** appear as `set (42 chars)` or `unset`, never the text you wrote.
- **Ollama host** appears verbatim only when it is a loopback address such as `http://127.0.0.1:11434`. Any other host becomes `custom host, port 11434`, so a machine name on your network is not disclosed.

The engine logs themselves are recorded by the inference engine and are not scrubbed. Read them before you paste.

## Data sharing

We do not sell or transfer user data to third parties, we do not use or transfer user data for any purpose unrelated to the extension's single purpose, and we do not use user data to determine creditworthiness or for lending purposes.

## Permissions

Apogee requests only the permissions needed for on-device summarization and question-answering of the page you are viewing (reading the active tab on your action, running a local AI model, storing your settings, and showing results).

It holds standing access to exactly three kinds of host, and nothing else:

- `http://127.0.0.1` and `http://localhost`, the loopback address used for your own local Ollama server (section 2 above).
- `*.bilibili.com` and `*.hdslb.com`, needed to read the subtitle track of a Bilibili video you are watching (section 5 above). This is the one request Apogee sends with a site's cookies, because Bilibili only exposes subtitle URLs to a logged-in session.

Every other page is read only at the moment you invoke Apogee on it, through the `activeTab` permission, which grants access to the single tab you are looking at and only for that action. Apogee never requests access to all websites.

## Open source

Apogee is free and open source under the MIT license. You can inspect exactly what it does, including every network request, in the source code:

https://github.com/darshi1337/apogee

## Contact

Questions or concerns: please open an issue at https://github.com/darshi1337/apogee/issues
