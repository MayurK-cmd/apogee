// Offscreen document, WebGPU execution context for MLCEngine.
// Receives messages from the service worker, runs inference, and streams tokens back via chrome.runtime port connections.
// IMPORTANT: We use dynamic imports for @mlc-ai/web-llm and prompt helpers so that message handlers (especially check-webgpu) register immediately without waiting for the heavy ~6 MB web-llm module to load. If the static import fails at the top level, the entire module dies and no handlers register,this was the root cause of the false "WebGPU not supported" bug.

import { parseSuggestedQuestions } from "../lib/summarize/questions.js";
import { summarizeText } from "../lib/summarize/ollamaSummarize.js";
import { resolveEffectiveLanguage } from "../lib/language/detectLanguage.js";
import {
  streamInTargetLanguage,
  generateInTargetLanguage,
} from "../lib/language/languageOutput.js";
import { makeOpusTranslateFn } from "../lib/language/opusTranslateEngine.js";
import {
  retrieveRelevantContent,
  findBestPassage,
  selectSalientChunks,
} from "../lib/retrieval/rag.js";
import { createLock } from "../lib/util/mutex.js";
import { WEBLLM_MODELS, TRANSLATION_ENGINES } from "../lib/constants.js";
// Chrome/Edge run the Transformers.js (ONNX/WASM) provider here in the offscreen
// document too, not just WebLLM: the MV3 service worker can't reliably
// dynamic-import @huggingface/transformers (same reason the embedding pipeline
// runs here, see lib/engines/embeddings.js). On Firefox this engine runs in the
// background page instead (see background/service-worker.js's transformers-stream
// handler); these helpers are browser-agnostic, so both hosts share them.
import {
  withTransformersEngine,
  transformersChatStream,
  getTransformersStatus,
} from "../lib/engines/transformersEngine.js";

// Forward all console logs to the service worker for remote debugging
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

function sendLogToServiceWorker(level, args) {
  const message = args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");

  chrome.runtime
    .sendMessage({
      target: "service-worker",
      type: "offscreen-log",
      level,
      message,
    })
    .catch(() => {});
}

console.log = (...args) => {
  originalConsole.log(...args);
  sendLogToServiceWorker("log", args);
};
console.error = (...args) => {
  originalConsole.error(...args);
  sendLogToServiceWorker("error", args);
};
console.warn = (...args) => {
  originalConsole.warn(...args);
  sendLogToServiceWorker("warn", args);
};
console.info = (...args) => {
  originalConsole.info(...args);
  sendLogToServiceWorker("info", args);
};

window.addEventListener("error", (event) => {
  console.error(
    "Global error in offscreen document:",
    event.message,
    "at",
    event.filename,
    ":",
    event.lineno,
  );
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(
    "Unhandled promise rejection in offscreen document:",
    event.reason?.stack || event.reason?.message || event.reason,
  );
});

let engine = null;
let currentModelId = null;
let loadingModelId = null;

// Serialization Mutex for the WebLLM engine (see lib/util/mutex.js):
// Because MLCEngine / WebGPU is highly stateful, running overlapping model operations (such as starting a new inference task or suggestions while a previous inference stream is finishing, or loading/unloading models concurrently) can corrupt the WebGPU device context and throw "Buffer was unmapped before mapping was resolved" errors.
// This guarantees only one engine operation runs at a time.
const acquireLock = createLock();

// Which stream (by streamId) currently holds the engine inside withEngine, or
// null when the holder isn't a cancellable stream (e.g. suggest-questions) or
// nothing holds it. cancel-stream consults this so interrupting the *current*
// generation only happens when the stream being cancelled is the one actually
// generating, see the "cancel-stream" handler below.
let engineOwnerStreamId = null;

let _webllm = null;
let _prompts = null;

async function getWebLLM() {
  if (!_webllm) {
    _webllm = await import("@mlc-ai/web-llm");
  }
  return _webllm;
}

async function getPrompts() {
  if (!_prompts) {
    _prompts = await import("../lib/summarize/prompts.js");
  }
  return _prompts;
}

async function ensureEngine(modelId) {
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine) {
    try {
      await engine.unload();
    } catch {
      // ignore
    }
    engine = null;
    currentModelId = null;
  }

  loadingModelId = modelId;

  const { CreateMLCEngine, prebuiltAppConfig } = await getWebLLM();

  // Serve each catalog model's model-library WASM kernel from the extension
  // package (assets/model-libs/, downloaded + SHA-256-verified at build time,
  // see scripts/model-libs.mjs) instead of prebuiltAppConfig's default
  // raw.githubusercontent.com URL: remotely fetched executable code is a
  // supply-chain hole and a Chrome Web Store policy violation, and the CSP
  // no longer allows that host anyway. Model *weights* still stream from
  // Hugging Face (data, not code), unchanged.
  const bundledModelLibs = new Map(
    WEBLLM_MODELS.filter((m) => m.lib).map((m) => [
      m.id,
      chrome.runtime.getURL(`assets/model-libs/${m.lib}`),
    ]),
  );

  const sendProgress = (progress) => {
    chrome.runtime
      .sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress,
        modelId,
      })
      .catch(() => {});
  };

  // web-llm's loader only reports progress once per *completed* param shard
  // (~26 MB each), so on a slow CDN day the popup's progress line can sit
  // frozen for a minute+ per shard and read as a hang. While loading, if no
  // real report arrives for STALL_NOTE_MS, re-emit the last one with a
  // "still downloading" note so the user can tell slow from dead.
  const STALL_NOTE_MS = 45 * 1000;
  let lastReport = null;
  let stallTimer = null;
  const scheduleStallNote = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (lastReport) {
        sendProgress({
          ...lastReport,
          text:
            `${lastReport.text} - still downloading, the model host is ` +
            "responding slowly. Progress is saved as it goes.",
        });
      }
      scheduleStallNote();
    }, STALL_NOTE_MS);
  };

  const engineOptions = {
    initProgressCallback: (report) => {
      lastReport = report;
      scheduleStallNote();
      sendProgress(report);
    },
    appConfig: {
      ...prebuiltAppConfig,
      cacheBackend: "cache",
      model_list: prebuiltAppConfig.model_list.map((m) =>
        bundledModelLibs.has(m.model_id)
          ? { ...m, model_lib: bundledModelLibs.get(m.model_id) }
          : m,
      ),
    },
  };

  // Hugging Face's CDN can stall or reset mid-download of the multi-hundred-MB
  // param shards; web-llm surfaces that as a cryptic "Failed to execute 'add'
  // on 'Cache'" TypeError and gives up, even though every already-completed
  // shard is saved in Cache Storage and a rerun resumes from there. Retry a
  // few times with growing backoff (each attempt is monotonic forward
  // progress thanks to that cache), and translate the error for the user
  // either way (the original goes to the debug logs via console.error).
  const MAX_DOWNLOAD_ATTEMPTS = 4;
  try {
    scheduleStallNote();
    for (let attempt = 1; ; attempt++) {
      try {
        engine = await CreateMLCEngine(modelId, engineOptions);
        break;
      } catch (err) {
        console.error(`Model load attempt ${attempt} failed:`, err);
        if (!isInterruptedDownloadError(err)) throw err;
        if (attempt >= MAX_DOWNLOAD_ATTEMPTS) {
          throw new Error(
            "The model download keeps getting interrupted (the download " +
              "server stalled or the connection dropped). Progress so far " +
              "is saved, so trying again later will resume where it left " +
              "off.",
            { cause: err },
          );
        }
        sendProgress({
          progress: 0,
          text: `Download hiccup — retrying (attempt ${attempt + 1} of ${MAX_DOWNLOAD_ATTEMPTS})...`,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  } finally {
    clearTimeout(stallTimer);
  }

  currentModelId = modelId;
  loadingModelId = null;
  return engine;
}

// The failure signature of a param-shard download dying mid-stream: web-llm's
// artifact cache does `cache.add(url)`, and the Cache API reports any fetch
// failure (connection reset, stall timeout, non-OK response) as this
// TypeError. Distinct from e.g. WebGPU/OOM errors, which a retry won't fix.
function isInterruptedDownloadError(err) {
  return /cache\.add|network\s?error|failed to fetch/i.test(err?.message || "");
}

// ensureEngine's fast path trusts currentModelId and hands back the cached
// engine without checking it's still healthy. If a prior operation crashed
// the WebGPU device (e.g. the "Buffer was unmapped..." class of error) but
// left engine/currentModelId untouched, every subsequent call would keep
// reusing the now-broken engine and fail with WebLLM's "Model not loaded"
// error forever, until the extension was reloaded. Any caller that touches
// the engine must go through this so a failure forces a full reload next time.
function resetEngineState() {
  engine = null;
  currentModelId = null;
  loadingModelId = null;
}

// `ownerStreamId` records which stream holds the engine while `fn` runs, set
// only *after* the lock is acquired so a queued stream (still waiting behind
// the current holder) can't be mistaken for the one actively generating. Left
// null by non-stream callers (e.g. suggest-questions).
async function withEngine(modelId, fn, ownerStreamId = null) {
  const release = await acquireLock();
  engineOwnerStreamId = ownerStreamId;
  try {
    const eng = await ensureEngine(modelId);
    return await fn(eng);
  } catch (err) {
    resetEngineState();
    throw err;
  } finally {
    engineOwnerStreamId = null;
    release();
  }
}

// Drives a web-llm streaming completion to its natural end, yielding text
// deltas. Draining fully is REQUIRED, not just tidy: web-llm's
// chat.completions.create() acquires an internal per-model lock and only
// releases it when its own async generator runs to completion or throws (in
// @mlc-ai/web-llm's asyncGenerate the lock.release() calls sit in the catch
// branches and after the final chunk, with NO `finally`). Closing the iterator
// early, i.e. a bare `return`/`break` out of a `for await`, which invokes the
// iterator's `.return()`, skips every one of those releases and leaks the lock
// permanently: the next generation then blocks forever on lock.acquire() with
// no error, recoverable only by tearing down this offscreen document (reloading
// the extension). So to stop early we must NOT break; we set web-llm's own stop
// flag via interruptGenerate() (checked at the top of its decode loop) and keep
// pulling until the generator ends itself, releasing the lock.
async function* drainWebLLMStream(eng, completion, signal) {
  let interrupted = false;
  for await (const chunk of completion) {
    if (signal?.aborted && !interrupted) {
      interrupted = true;
      // Fire-and-forget: interruptGenerate() just sets the interrupt flag,
      // the same call the "cancel-stream" handler below makes.
      eng.interruptGenerate();
    }
    // Once interrupted, keep consuming so the generator finishes and releases
    // its lock, but stop surfacing tokens to the caller.
    if (interrupted) continue;
    const text = chunk.choices?.[0]?.delta?.content || "";
    if (text) yield text;
  }
}

// lib/language/languageOutput.js-shaped chat function over the WebLLM engine:
// chatFn(prompt, { signal, system }) -> async iterable of text tokens, with an
// optional system message. Used by the ask/suggest language wrappers so they
// get the same single-pass-directive + verify + translate-fallback behavior as
// summaries.
function webllmChatFn(eng) {
  return async function* (prompt, { signal, system } = {}) {
    const messages = system
      ? [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ]
      : [{ role: "user", content: prompt }];
    const completion = await eng.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 2048,
    });
    yield* drainWebLLMStream(eng, completion, signal);
  };
}

// Same shape over the Transformers.js engine (single-message chat + optional
// system), shared by both the ask/suggest wrappers here and Firefox's copy.
function transformersChatFn(eng) {
  return (prompt, { system } = {}) =>
    transformersChatStream(eng, prompt, { system });
}

async function streamCompletion(
  eng,
  prompt,
  emit,
  signal,
  language,
  translateFn,
) {
  // A cancel broadcasts its own "cancelled" message separately (see the
  // "cancel-stream" handler below); drainWebLLMStream stops surfacing tokens
  // once the signal aborts, so nothing extra is emitted here after that. The
  // language wrapper adds the system directive + translate fallback (no-op when
  // `language` is "auto"); `translateFn` (when opus mode) supplies dedicated MT.
  for await (const text of streamInTargetLanguage(
    webllmChatFn(eng),
    prompt,
    language,
    { signal, translateFn },
  )) {
    emit({ type: "chunk", text });
  }

  emit({ type: "done" });
}

function reportProgress(text, progress = 0) {
  chrome.runtime
    .sendMessage({
      target: "service-worker",
      type: "model-progress",
      progress: { text, progress },
    })
    .catch(() => {});
}

// Builds the Opus-MT translateFn for a job when its translationEngine is
// "opus", else undefined (LLM path). Download progress surfaces on the same
// model-progress line as everything else, forward the numeric fraction the
// engine reports (see ensureTranslator in transformersEngine.js) so the
// download bar actually fills instead of sitting at 0% behind a text label.
function opusTranslateFor(translationEngine) {
  if (translationEngine !== TRANSLATION_ENGINES.OPUS) return undefined;
  return makeOpusTranslateFn((p) => reportProgress(p.text, p.progress ?? 0));
}

// Chunk-aware summarization for the small in-browser models, delegated to the
// shared summarizeText core (lib/summarize/ollamaSummarize.js) so WebLLM and Ollama
// produce identical output for the same page. summarizeText owns the
// chunking + map-reduce logic; here we only adapt the WebLLM engine to look
// like an Ollama-style token stream and forward its tokens.
//
// Every mode (including bullets) runs a map pass per chunk then a single
// reduce/synthesis pass over all chunks' output together, so a long document
// still reads as one coherent result instead of a flat concatenation of
// per-chunk output. Bullets' reduce pass scales its target bullet count with
// how many chunks were merged (see buildScaledBulletsStyle in lib/summarize/prompts.js)
// so a long PDF still gets proportionally more bullets instead of being
// crushed to a fixed 8-14 total.
async function runSummarize(eng, pending, emit, signal) {
  // Presents the WebLLM engine as summarizeText's chatStreamFn seam. The
  // host/model args come baked into the prompt already, so they're ignored.
  // `system` (when summarizeText forces the output language on its first pass)
  // becomes a real system message, weighted far more than an inline directive.
  async function* webllmChatStream(_host, _model, prompt, opts) {
    const messages = opts?.system
      ? [
          { role: "system", content: opts.system },
          { role: "user", content: prompt },
        ]
      : [{ role: "user", content: prompt }];
    const completion = await eng.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 2048,
    });
    // Must drain to the end (interrupting on abort rather than returning early)
    // so web-llm releases its per-model lock, see drainWebLLMStream's note.
    yield* drainWebLLMStream(eng, completion, signal);
  }

  const onProgress = (p) => {
    if (p.stage === "truncated") {
      reportProgress("Long page — summarizing the key parts.");
    } else if (p.stage === "reduce") {
      reportProgress("Merging summary...");
    } else if (p.stage === "translate") {
      reportProgress("Translating...");
    } else {
      reportProgress(`Summarizing part ${p.index + 1} of ${p.total}...`);
    }
  };

  // Skip the translate pass when the page is already in the target language.
  const language = await resolveEffectiveLanguage(
    pending.content,
    pending.language,
  );
  // The offscreen document has no chrome.storage API (only chrome.runtime), so
  // the custom-instructions setting can't be read here, the service worker
  // injects it into the job payload before forwarding (see the offscreen sends
  // in background/service-worker.js). Same for runTransformersJob / the Ask
  // path below.
  const customInstructions = pending.customInstructions;
  for await (const token of summarizeText(
    {
      text: pending.content,
      title: pending.title,
      url: pending.url,
      mode: pending.mode,
      type: pending.type,
      model: pending.model,
      language,
      customInstructions,
      signal,
    },
    {
      chatStreamFn: webllmChatStream,
      onProgress,
      translateFn: opusTranslateFor(pending.translationEngine),
      // Cover a too-long page by embedding-salience (the model runs here in the
      // offscreen document), not head-truncation. See selectSalientChunks.
      selectChunksFn: (chunks, k) => selectSalientChunks(chunks, k),
    },
  )) {
    emit({ type: "chunk", text: token });
  }
  emit({ type: "done" });
}

// Stream jobs, keyed by streamId, buffered here rather than in the service
// worker: the SW gets evicted after ~30s of inactivity (e.g. a long model
// download with sparse progress ticks, or the popup closing on blur), which
// wipes any in-memory Map it holds. This offscreen document has no such
// automatic eviction, it only closes via our own explicit idle-close logic
// in the service worker, so it's the durable side to own the buffer and
// keep generating even while nothing is listening.
const streams = new Map();

const STREAM_CLEANUP_MS = 2 * 60 * 1000;
function scheduleStreamCleanup(streamId) {
  setTimeout(() => {
    const stream = streams.get(streamId);
    if (!stream) return;
    streams.delete(streamId);
    for (const port of stream.subscribers) {
      try {
        port.disconnect();
      } catch {}
    }
  }, STREAM_CLEANUP_MS);
}

function broadcastToStream(stream, msg) {
  for (const port of stream.subscribers) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

// Transformers.js (ONNX/WASM) counterpart of the WebLLM withEngine(...) block
// in runStream, used when a job's provider is "transformers" (Chrome/Edge).
// Mirrors startTransformersStream in background/service-worker.js, which runs
// the identical logic in Firefox's background page; the difference is only
// where it runs, so the engine helpers are shared. Serialized by
// transformersEngine.js's own lock, independent of the WebLLM engine lock.
async function runTransformersJob(
  pending,
  askPrompt,
  askLanguage,
  emit,
  signal,
) {
  // Model-download progress from the engine loader. Per-chunk stage progress
  // ("Summarizing part N of M...") is surfaced via reportProgress inside the
  // summarize branch instead, same split as the WebLLM path.
  const onDownloadProgress = (progress) => {
    chrome.runtime
      .sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress,
        modelId: pending.model,
      })
      .catch(() => {});
  };

  // Stage label + word ticker: each map/reduce pass on this CPU engine is
  // otherwise silent for its whole prefill+decode (tens of seconds to
  // minutes), which users read as a freeze. The ticker advances the existing
  // progress line with a rough word count so the popup visibly moves; the
  // sticky "Long page" prefix survives past the one-shot truncated event.
  let longNote = "";
  let stageLabel = "Summarizing...";

  // Injected into the payload by the service worker (offscreen has no
  // chrome.storage; see the note in runSummarize).
  const customInstructions = pending.customInstructions;

  await withTransformersEngine(
    pending.model,
    onDownloadProgress,
    async (eng) => {
      if (pending.action === "summarize") {
        const language = await resolveEffectiveLanguage(
          pending.content,
          pending.language,
        );
        const generator = summarizeText(
          {
            text: pending.content,
            title: pending.title,
            url: pending.url,
            mode: pending.mode,
            type: pending.type,
            model: pending.model,
            language,
            customInstructions,
            signal,
          },
          {
            // transformers.js/ONNX has no native abort, so a cancel takes
            // effect between tokens here and, via summarizeText's own signal
            // checks, between chunks.
            translateFn: opusTranslateFor(pending.translationEngine),
            selectChunksFn: (chunks, k) => selectSalientChunks(chunks, k),
            chatStreamFn: async function* (_host, _model, prompt, opts) {
              let count = 0;
              for await (const token of transformersChatStream(eng, prompt, {
                system: opts?.system,
              })) {
                if (signal?.aborted) return;
                count++;
                if (count % 24 === 0) {
                  reportProgress(`${longNote}${stageLabel} (${count} words)`);
                }
                yield token;
              }
            },
            onProgress: (p) => {
              if (p.stage === "truncated") {
                longNote = "Long page — summarizing the key parts. ";
                reportProgress(longNote.trim());
                return;
              }
              if (p.stage === "reduce") stageLabel = "Merging summary...";
              else if (p.stage === "translate") stageLabel = "Translating...";
              else
                stageLabel = `Summarizing part ${p.index + 1} of ${p.total}...`;
              reportProgress(longNote + stageLabel);
            },
          },
        );
        for await (const token of generator) {
          emit({ type: "chunk", text: token });
        }
        emit({ type: "done" });
      } else if (pending.action === "ask") {
        // askPrompt is built provider-agnostically in runStream (RAG retrieval
        // + buildAnswerPrompt); the language wrapper enforces askLanguage.
        for await (const token of streamInTargetLanguage(
          transformersChatFn(eng),
          askPrompt,
          askLanguage,
          { signal, translateFn: opusTranslateFor(pending.translationEngine) },
        )) {
          if (signal?.aborted) break;
          emit({ type: "chunk", text: token });
        }
        emit({ type: "done" });
      } else {
        emit({ type: "error", error: `Unknown action: ${pending.action}` });
      }
    },
  );
}

// Runs a generation job to completion, independent of any subscriber port,
// started as soon as the job is requested rather than waiting for the
// service worker to attach a relay port, so a popup closing (or the SW
// restarting) mid-generation no longer aborts the job.
async function runStream(streamId, pending, stream) {
  // A separate signal from the engine lock/WebGPU device itself: cancel
  // needs both this (so summarizeText and the chat-stream wrappers above
  // stop asking for more tokens) and engine.interruptGenerate() (so the
  // *current* in-flight generation actually stops producing them), see the
  // "cancel-stream" handler below.
  const controller = new AbortController();
  stream.controller = controller;

  const emit = (msg) => {
    // Once cancelled, the "cancelled" handler already broadcast the terminal
    // message itself; ignore anything the job emits afterward (e.g. a late
    // "done" from a chunk that was mid-flight when interruptGenerate() was
    // called) so it can't clobber the cancelled state.
    if (stream.cancelled) return;
    if (msg.type === "chunk") stream.text += msg.text || "";
    if (msg.type === "done") stream.done = true;
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.done = true;
    }
    broadcastToStream(stream, msg);

    // This job runs in this document, not the service worker, so unlike
    // startOllamaStream/startTransformersStream (which finalize a finished
    // summarize job directly, same file, see their own finish()), it has to
    // proactively tell the service worker it's done rather than being able
    // to call finalizeSummaryJob itself. Only for summarize jobs carrying a
    // `finalize` (background-triggered jobs and popup-triggered ones alike,
    // see lib/engines/providers.js's WebLLMProvider.summarize), and only on success,
    // a cancelled job never reaches here (guarded above) and an error
    // shouldn't persist a partial/failed result.
    if (
      msg.type === "done" &&
      pending.action === "summarize" &&
      pending.finalize
    ) {
      chrome.runtime
        .sendMessage({
          target: "service-worker",
          type: "stream-finished",
          finalize: pending.finalize,
          model: pending.model,
          title: pending.title,
          url: pending.url,
          text: stream.text,
        })
        .catch(() => {});
    }
  };

  try {
    // Computed outside withEngine: it's WASM/CPU work (see lib/engines/embeddings.js),
    // unrelated to the WebGPU engine the lock exists to serialize, so it
    // shouldn't sit blocked behind (or block) another engine operation.
    let askPrompt = null;
    let askLanguage = "auto";
    if (pending.action === "ask") {
      const relevantContent = await retrieveRelevantContent({
        content: pending.content,
        question: pending.question,
      });
      const prompts = await getPrompts();
      // No inline language directive on the prompt (small models ignore it);
      // the answer's language is enforced by streamInTargetLanguage instead.
      // Custom instructions apply to answers too (injected into the payload by
      // the service worker, offscreen has no chrome.storage, see runSummarize).
      askPrompt = prompts.withCustomInstructions(
        prompts.buildAnswerPrompt(
          pending.title,
          pending.url,
          relevantContent,
          pending.question,
        ),
        pending.customInstructions,
      );
      // Detect against the full article so an answer about an already-in-target
      // page skips the directive/translate entirely.
      askLanguage = await resolveEffectiveLanguage(
        pending.content,
        pending.language,
      );
    }

    if (pending.provider === "transformers") {
      await runTransformersJob(
        pending,
        askPrompt,
        askLanguage,
        emit,
        controller.signal,
      );
    } else {
      await withEngine(
        pending.model,
        async (eng) => {
          switch (pending.action) {
            case "summarize":
              await runSummarize(eng, pending, emit, controller.signal);
              break;

            case "ask":
              await streamCompletion(
                eng,
                askPrompt,
                emit,
                controller.signal,
                askLanguage,
                opusTranslateFor(pending.translationEngine),
              );
              break;

            default:
              emit({
                type: "error",
                error: `Unknown action: ${pending.action}`,
              });
          }
        },
        streamId,
      );
    }
  } catch (err) {
    if (stream.cancelled) return;
    emit({ type: "error", error: err.message });
    chrome.runtime
      .sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress: { text: `Error: ${err.message}`, progress: 0 },
      })
      .catch(() => {});
  } finally {
    scheduleStreamCleanup(streamId);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("offscreen-stream-")) return;

  const streamId = port.name.replace("offscreen-stream-", "");
  const stream = streams.get(streamId);

  if (!stream) {
    try {
      port.postMessage({
        type: "error",
        error:
          "This response is no longer available (its stream expired). " +
          "Try summarizing again.",
      });
    } catch {}
    try {
      port.disconnect();
    } catch {}
    return;
  }

  // Subscribing just replays what's buffered so far, then relays live
  // chunks, it never starts or restarts the underlying job.
  stream.subscribers.add(port);
  if (stream.text) {
    try {
      port.postMessage({ type: "chunk", text: stream.text });
    } catch {}
  }
  if (stream.cancelled) {
    try {
      port.postMessage({ type: "cancelled" });
    } catch {}
  } else if (stream.error) {
    try {
      port.postMessage({ type: "error", error: stream.error });
    } catch {}
  } else if (stream.done) {
    try {
      port.postMessage({ type: "done" });
    } catch {}
  }

  port.onDisconnect.addListener(() => {
    stream.subscribers.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  // Same own-extension check as the service worker's listener: only this
  // extension's contexts may drive inference here.
  if (sender.id !== chrome.runtime.id) return false;

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          const streamId = message.streamId;
          const stream = {
            text: "",
            done: false,
            error: null,
            cancelled: false,
            subscribers: new Set(),
          };
          streams.set(streamId, stream);
          sendResponse({ streamId });
          // Not awaited: the job runs independently of this message/response
          // and of any port ever attaching to it.
          runStream(
            streamId,
            { action: message.action, ...message.payload },
            stream,
          );
          break;
        }

        case "cancel-stream": {
          const stream = streams.get(message.payload.streamId);
          if (stream && !stream.done) {
            stream.cancelled = true;
            stream.done = true;
            broadcastToStream(stream, { type: "cancelled" });
            // Stops summarizeText/streamCompletion from asking for more
            // chunks; interruptGenerate() stops the *current* one, the one
            // already in flight when cancel was clicked, immediately.
            try {
              stream.controller?.abort();
            } catch {}
            // Only interrupt when this stream is the one actually holding the
            // engine. The engine lock serializes generations, so cancelling a
            // *queued* stream (or one already finished with the engine) must
            // not interrupt whichever different stream currently owns it, e.g.
            // a rapid resummarize where the new job holds the engine while the
            // old one is being cancelled.
            if (engineOwnerStreamId === message.payload.streamId) {
              try {
                engine?.interruptGenerate?.();
              } catch {}
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case "has-active-streams": {
          sendResponse({
            active: [...streams.values()].some((s) => !s.done),
          });
          break;
        }

        // Used by the Local Ollama "ask" path (background/service-worker.js's
        // getRelevantAskContent): that path builds its own prompt and streams
        // from Ollama directly rather than through this document's engine, it
        // only needs the relevant-content selection itself, which requires
        // the embedding model's dynamic import(), disallowed in the service
        // worker's ServiceWorkerGlobalScope by spec (see lib/engines/embeddings.js).
        case "retrieve-context": {
          const { content, question } = message.payload;
          const relevantContent = await retrieveRelevantContent({
            content,
            question,
          });
          sendResponse({ content: relevantContent });
          break;
        }

        // "Highlight in page": find which original-content chunk a clicked
        // summary bullet is most likely grounded in, see lib/retrieval/rag.js's
        // findBestPassage and the popup.js click handler that calls this.
        // Same embedding-model/offscreen-document constraint as
        // "retrieve-context" above, Chrome/Chromium only.
        case "find-passage": {
          const { content, query } = message.payload;
          const passage = await findBestPassage({ content, query });
          sendResponse({ passage });
          break;
        }

        case "suggest-questions": {
          const {
            title,
            url,
            summary,
            model,
            provider,
            language,
            translationEngine,
          } = message.payload;
          const prompts = await getPrompts();
          // Neutral prompt (no inline directive); the language wrapper forces
          // the target language on the questions, same as ask answers. Gate on
          // the SUMMARY's language: it's already in the target language, so this
          // is usually "auto" (pass through, questions inherit that language),
          // which avoids an unreliable language check on just two short questions.
          const prompt = prompts.buildSuggestQuestionsPrompt(
            title,
            url,
            summary,
          );
          const qLanguage = await resolveEffectiveLanguage(summary, language);
          const translateFn = opusTranslateFor(translationEngine);
          const questions =
            provider === "transformers"
              ? await withTransformersEngine(model, null, async (eng) => {
                  const text = await generateInTargetLanguage(
                    transformersChatFn(eng),
                    prompt,
                    qLanguage,
                    { translateFn },
                  );
                  return parseSuggestedQuestions(text);
                })
              : await withEngine(model, async (eng) => {
                  const text = await generateInTargetLanguage(
                    webllmChatFn(eng),
                    prompt,
                    qLanguage,
                    { translateFn },
                  );
                  return parseSuggestedQuestions(text);
                });

          sendResponse({ questions });
          break;
        }

        case "status": {
          let webgpuAvailable = false;
          try {
            if (navigator.gpu) {
              const adapter = await navigator.gpu.requestAdapter();
              webgpuAvailable = adapter !== null;
            }
          } catch {
            // WebGPU probe failed
          }
          sendResponse({
            ready: webgpuAvailable,
            currentModel: currentModelId,
            loading: loadingModelId,
          });
          break;
        }

        // Transformers.js provider status on Chrome/Edge, where its engine runs
        // here rather than in the service worker. Mirrors the service worker's
        // in-process transformers-status (Firefox): `ready` reflects the
        // runtime capability (WASM), not whether a model is already loaded.
        case "transformers-status": {
          const { currentModelId: tCurrent, loadingModelId: tLoading } =
            getTransformersStatus();
          sendResponse({
            ready: typeof WebAssembly !== "undefined",
            currentModel: tCurrent,
            loading: tLoading,
          });
          break;
        }

        case "check-webgpu": {
          if (!navigator.gpu) {
            sendResponse({
              supported: false,
              reason: "navigator.gpu is undefined",
            });
            break;
          }
          try {
            const adapter = await navigator.gpu.requestAdapter();

            sendResponse({
              supported: adapter !== null,
              reason: adapter ? "ok" : "no adapter",
            });
          } catch (err) {
            sendResponse({ supported: false, reason: err.message });
          }
          break;
        }

        default:
          sendResponse({ error: `Unknown action: ${message.action}` });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  };

  handler();
  return true;
});

chrome.runtime
  .sendMessage({
    target: "service-worker",
    type: "offscreen-ready",
  })
  .catch(() => {});
