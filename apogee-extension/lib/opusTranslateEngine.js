// Builds the dedicated-MT `translateFn` that streamInTargetLanguage uses in
// "opus" mode (see lib/languageOutput.js). Kept separate from the pure resolver
// (lib/opusTranslate.js) because it wires in the Transformers.js translation
// engine and language detection, both only available in the offscreen document
// (Chrome) and the background page (Firefox), which are the only hosts that
// build this. Ollama jobs never use it.

import { withTranslator, translateBatch } from "./transformersEngine.js";
import { detectPrimaryLanguage } from "./detectLanguage.js";
import {
  resolveOpusModel,
  translatePreservingStructure,
} from "./opusTranslate.js";

// Returns translateFn(text, targetLang) -> Promise<string | null>: detects the
// text's source language, resolves an Opus-MT model for source -> target,
// lazily loads it (download progress via onProgress), and translates line by
// line preserving bullet/timestamp structure. Returns null when Opus-MT can't
// cover the pair, so the caller falls back to the LLM translate.
export function makeOpusTranslateFn(onProgress) {
  return async (text, targetLang) => {
    const detected = await detectPrimaryLanguage(text);
    // Fall back to assuming English source when detection is unsure, the
    // neutral summary is English far more often than not.
    const src = (detected || "en").toLowerCase().split("-")[0];
    const resolved = resolveOpusModel(src, targetLang);
    if (!resolved) return null;
    try {
      return await withTranslator(resolved.model, onProgress, (t) =>
        translatePreservingStructure(
          text,
          (lines) => translateBatch(t, lines, resolved.token),
          {
            // Replace the frozen "Downloading... 100%" label with live
            // translate progress once the model is loaded.
            onProgress: (done, total) =>
              onProgress?.({
                progress: total ? done / total : 1,
                text: `Translating ${done}/${total}...`,
              }),
          },
        ),
      );
    } catch {
      // A failed/unavailable model (e.g. a bad download) shouldn't sink the
      // whole job, fall back to the LLM translate.
      return null;
    }
  };
}
