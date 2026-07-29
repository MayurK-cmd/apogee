# Apogee Privacy Policy

_Last updated: 2026-07-27_

Apogee is a private, in-browser AI assistant. It is designed so that the
content you summarize or ask questions about is processed **entirely on your
own device** and is **never sent to us or to any third-party server**. We do
not operate any backend, we have no servers that receive your data, and we
collect no analytics or telemetry of any kind.

## What we collect

**Nothing.** Apogee has no account system, no sign-in, and no server. We do
not collect, transmit, sell, or share any user data.

- **Page content** (article text, YouTube transcripts, PDF text) that you ask
  Apogee to summarize or answer questions about is read from the tab you are
  actively viewing, processed locally by an AI model running on your device,
  and then discarded. It is never uploaded.
- **Your settings** (chosen AI provider and model, summary format, and other
  preferences) are stored locally in your browser via the extension storage
  API. They stay on your device.

## Network connections Apogee makes

Apogee is offline-first, but a few features require specific, limited network
connections. None of them transmit your page content or summaries to a
third party.

1. **Model weight downloads (first run).** The first time you use an
   in-browser model, Apogee downloads the model's weight files from
   Hugging Face (`huggingface.co` and related hosts) and caches them locally.
   This is a one-time download of the model itself; no information about the
   pages you visit is included. As with any file download, Hugging Face sees
   your IP address and which model you fetched, and nothing more. After
   caching, in-browser AI runs fully offline.

2. **Local Ollama (optional).** If you opt into Local Ollama mode, Apogee
   connects to an Ollama instance running on your own machine at
   `http://127.0.0.1` or `http://localhost`. This traffic stays on your
   device and never leaves it.

3. **SponsorBlock (optional, YouTube only).** When summarizing a YouTube
   video, Apogee can query the community SponsorBlock API
   (`sponsor.ajay.app`) for sponsor-segment timings so it can skip sponsor
   reads and self-promotion when summarizing the transcript. The full video
   ID is never sent: Apogee sends only the first four characters of its
   SHA-256 hash, a prefix shared by many videos, and filters the returned
   segments locally (the same k-anonymity scheme the official SponsorBlock
   clients use). SponsorBlock therefore sees your IP address and that a
   YouTube summary is happening, but not which video. It can be disabled in
   the extension's settings.

We do not control Hugging Face or SponsorBlock; their own privacy policies
govern the requests described above.

## Data sharing

We do not sell or transfer user data to third parties, we do not use or
transfer user data for any purpose unrelated to the extension's single
purpose, and we do not use user data to determine creditworthiness or for
lending purposes.

## Permissions

Apogee requests only the permissions needed for on-device summarization and
question-answering of the page you are viewing (reading the active tab on your
action, running a local AI model, storing your settings, and showing results).
It requests no access to websites beyond the loopback address used for your
own local Ollama server.

## Open source

Apogee is free and open source under the MIT license. You can inspect exactly
what it does, including every network request, in the source code:

https://github.com/darshi1337/apogee

## Contact

Questions or concerns: please open an issue at
https://github.com/darshi1337/apogee/issues
