import {
  withTranslator,
  translateBatch,
} from "../engines/transformersEngine.js";
import { detectPrimaryLanguage } from "./detectLanguage.js";
import {
  resolveOpusModel,
  translatePreservingStructure,
} from "./opusTranslate.js";

export function makeOpusTranslateFn(onProgress) {
  return async (text, targetLang) => {
    const detected = await detectPrimaryLanguage(text);
    const src = (detected || "en").toLowerCase().split("-")[0];
    const resolved = resolveOpusModel(src, targetLang);
    if (!resolved) return null;
    try {
      return await withTranslator(resolved.model, onProgress, (t) =>
        translatePreservingStructure(
          text,
          (lines) => translateBatch(t, lines, resolved.token),
          {
            onProgress: (done, total) =>
              onProgress?.({
                progress: total ? done / total : 1,
                text: `Translating ${done}/${total}...`,
              }),
          },
        ),
      );
    } catch {
      return null;
    }
  };
}
