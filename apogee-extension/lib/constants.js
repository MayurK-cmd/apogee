// WebLLM model catalog, smaller quantized models suited for browser inference.
// The IDs must match entries in @mlc-ai/web-llm's prebuiltAppConfig.
//
// `lib` is the model-library WASM kernel bundled into the Chrome package
// (downloaded + hash-verified at build time, see scripts/model-libs.mjs) so
// web-llm never fetches executable code from raw.githubusercontent.com at
// runtime; offscreen.js rewrites each model's `model_lib` to point at this
// bundled copy. The filenames must match prebuiltAppConfig's own for the
// pinned @mlc-ai/web-llm version.

export const WEBLLM_MODELS = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    lib: "Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "Qwen 2.5 1.5B",
    size: "~900 MB",
    description: "Multilingual, instruction-tuned. Great for summarization.",
    default: true,
  },
  {
    id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    lib: "SmolLM2-1.7B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "SmolLM2 1.7B",
    size: "~1 GB",
    description: "Compact and efficient for general tasks.",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    lib: "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "Llama 3.2 1B",
    size: "~700 MB",
    description: "Lightweight, fast, and reliable.",
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    lib: "Phi-3.5-mini-instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "Phi 3.5 Mini",
    size: "~2.2 GB",
    description: "Stronger reasoning, larger download.",
  },
];

export const DEFAULT_WEBLLM_MODEL = WEBLLM_MODELS.find((m) => m.default).id;

// Transformers.js (ONNX/WASM) model catalog, used only on Firefox as its
// in-browser provider. Unlike WebLLM (WebGPU, needs an offscreen document
// Firefox doesn't have) or wllama (needs a dedicated Worker Firefox's
// background page won't allow), @huggingface/transformers's WASM backend
// runs on the calling thread with no Worker at all (it hardcodes
// ONNX_ENV.wasm.proxy = false), so it can run directly in Firefox's
// background page. Repo/dtype/file sizes verified against the Hugging Face
// API to exist.
export const TRANSFORMERS_MODELS = [
  {
    id: "HuggingFaceTB/SmolLM2-360M-Instruct",
    dtype: "q4f16",
    label: "SmolLM2 360M",
    size: "~270 MB",
    description: "Smallest and fastest, best for quick summaries on CPU.",
    default: true,
  },
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    dtype: "q4f16",
    label: "Qwen 2.5 0.5B",
    size: "~480 MB",
    description: "Multilingual, instruction-tuned.",
  },
  {
    id: "onnx-community/Llama-3.2-1B-Instruct-q4f16",
    dtype: "q4f16",
    label: "Llama 3.2 1B",
    size: "~1.2 GB",
    description: "Stronger reasoning, larger download and slower on CPU.",
  },
];

export const DEFAULT_TRANSFORMERS_MODEL = TRANSFORMERS_MODELS.find(
  (m) => m.default,
).id;

// Output-language catalog for summaries/answers/suggested questions. Mirrors
// the Kagi Universal Summarizer's target-language set (codes kept identical
// for familiarity). `name` is the English language name used in the
// system/translate prompts (see resolveLanguageName in lib/prompts.js); "auto"
// carries none and leaves output in the source language. Each generation runs
// through the SAME multilingual LLM: one pass with a system-role language
// directive, verified and (only on a slip) followed by a focused translate
// pass, no separate per-language translation model (see lib/languageOutput.js).
export const SUMMARY_LANGUAGES = [
  { code: "auto", label: "Same as article", name: null },
  { code: "en", label: "English", name: "English" },
  { code: "es", label: "Spanish", name: "Spanish" },
  { code: "fr", label: "French", name: "French" },
  { code: "de", label: "German", name: "German" },
  { code: "it", label: "Italian", name: "Italian" },
  { code: "pt", label: "Portuguese", name: "Portuguese" },
  { code: "nl", label: "Dutch", name: "Dutch" },
  { code: "pl", label: "Polish", name: "Polish" },
  { code: "ru", label: "Russian", name: "Russian" },
  { code: "uk", label: "Ukrainian", name: "Ukrainian" },
  { code: "cs", label: "Czech", name: "Czech" },
  { code: "sk", label: "Slovak", name: "Slovak" },
  { code: "sl", label: "Slovenian", name: "Slovenian" },
  { code: "bg", label: "Bulgarian", name: "Bulgarian" },
  { code: "ro", label: "Romanian", name: "Romanian" },
  { code: "hu", label: "Hungarian", name: "Hungarian" },
  { code: "el", label: "Greek", name: "Greek" },
  { code: "tr", label: "Turkish", name: "Turkish" },
  { code: "sv", label: "Swedish", name: "Swedish" },
  { code: "da", label: "Danish", name: "Danish" },
  { code: "nb", label: "Norwegian", name: "Norwegian" },
  { code: "fi", label: "Finnish", name: "Finnish" },
  { code: "et", label: "Estonian", name: "Estonian" },
  { code: "lv", label: "Latvian", name: "Latvian" },
  { code: "lt", label: "Lithuanian", name: "Lithuanian" },
  { code: "ja", label: "Japanese", name: "Japanese" },
  { code: "ko", label: "Korean", name: "Korean" },
  { code: "zh", label: "Chinese (Simplified)", name: "Simplified Chinese" },
  {
    code: "zh-hant",
    label: "Chinese (Traditional)",
    name: "Traditional Chinese",
  },
  { code: "id", label: "Indonesian", name: "Indonesian" },
];

// English default: summaries come out in English regardless of the source
// article's language. Users who prefer native-language summaries pick "auto".
export const DEFAULT_SUMMARY_LANGUAGE = "en";

// How cross-language output is translated (see lib/languageOutput.js).
// "llm" (default): the summarization model translates it itself (one pass with
// a system directive, verified, with an LLM translate fallback), no extra
// download. "opus": an opt-in dedicated Opus-MT translation model (Helsinki-NLP,
// lazy-downloaded per language, ~80MB direct pairs / one grouped model for the
// long tail; see lib/opusTranslate.js) does the translation instead, for higher
// fidelity on low-resource languages. Only applies to the in-browser providers
// (WebLLM/Transformers.js); Ollama always uses the LLM path.
export const TRANSLATION_ENGINES = { LLM: "llm", OPUS: "opus" };
export const DEFAULT_TRANSLATION_ENGINE = TRANSLATION_ENGINES.LLM;

// EXPERIMENTAL: request multi-threaded WASM for the Transformers.js engines
// (translation + Firefox text-gen). Multi-threading could give a near-linear
// speedup on CPU, but onnxruntime's WASM threads need SharedArrayBuffer, which
// needs cross-origin isolation, something MV3 extension pages don't get out of
// the box, and its pthread workers may hit the same worker-CSP wall that
// blocked wllama. Off by default: flip to true, rebuild, reload, and read the
// `[mt]` console diagnostics (see resolveWasmThreads in transformersEngine.js)
// to learn whether isolation/threads are actually reachable here. When off (or
// when isolation is absent) everything stays on the proven single-threaded path.
export const EXPERIMENTAL_WASM_THREADS = false;

export const LOCAL_MODELS = [
  { id: "qwen3:8b", label: "Qwen 3 8B" },
  { id: "mistral:latest", label: "Mistral Latest" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B" },
  { id: "gemma3:4b", label: "Gemma 3" },
];

export const DEFAULT_LOCAL_MODEL = "qwen3:8b";

const isFirefox = process.env.TARGET_BROWSER === "firefox";

// Firefox has no `browser.offscreen` API, so WebLLM (which needs an offscreen
// document to access WebGPU) can't run there. Transformers.js takes its
// place as the in-browser option on Firefox instead (see TRANSFORMERS_MODELS
// above for why it, unlike wllama, actually works there).
// Chrome/Edge offer BOTH in-browser engines: WebLLM (WebGPU, the default) and
// Transformers.js (ONNX/WASM, CPU) as an opt-in for machines without WebGPU or
// as an alternative to WebLLM. Both run in the offscreen document there (the
// MV3 service worker can't reliably dynamic-import either, see lib/embeddings.js).
// Firefox has no offscreen API/WebGPU, so it gets Transformers.js only, run in
// its background page.
export const PROVIDERS = isFirefox
  ? { TRANSFORMERS: "transformers", LOCAL: "local" }
  : { WEBLLM: "webllm", TRANSFORMERS: "transformers", LOCAL: "local" };

export const DEFAULT_PROVIDER = isFirefox
  ? PROVIDERS.TRANSFORMERS
  : PROVIDERS.WEBLLM;

// Ollama's own default HTTP port. The extension talks to Ollama directly,
// no intermediate backend server.
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export const DEFAULT_SETTINGS = {
  provider: DEFAULT_PROVIDER,
  webllmModel: DEFAULT_WEBLLM_MODEL,
  transformersModel: DEFAULT_TRANSFORMERS_MODEL,
  localModel: DEFAULT_LOCAL_MODEL,
  ollamaHost: DEFAULT_OLLAMA_HOST,
  responseFormat: "bullets",
  summaryLanguage: DEFAULT_SUMMARY_LANGUAGE,
  translationEngine: DEFAULT_TRANSLATION_ENGINE,
  theme: "dark",
  // When false, summaries/page content/Q&A are never written to disk (kept
  // only in memory for the current popup session). Sensitive hosts (see
  // isSensitiveUrl in popup.js) are always treated as non-persistable
  // regardless of this setting.
  saveHistory: true,
  // When false, the SponsorBlock k-anonymity lookup for YouTube sponsor
  // segments (the extension's only third-party network request, see
  // fetchSponsorBlockSegments in background/service-worker.js) is skipped
  // entirely and the local phrase heuristic is used instead.
  sponsorBlock: true,
};
