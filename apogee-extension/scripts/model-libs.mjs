import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WEBLLM_MODELS } from "../lib/constants.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MODEL_LIB_CACHE_DIR = resolve(ROOT, ".model-libs-cache");

const MODEL_LIB_URL_PREFIX =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/";

const MODEL_LIB_SHA256 = {
  "Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "0fceb50bbaf47efdc31fce96b72c115dcb7f5221c85abe6a9fc02dda9d1d6fc3",
  "SmolLM2-1.7B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "2f2842aeab20193f9149f705ed43d6702ca568d39c1f272790e1874ad96c15f4",
  "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "2aa9b5f0c8de532f6cbf6bb7b863aaa02645bf6fff856083b202f968712d3f92",
  "Phi-3.5-mini-instruct-q4f16_1_cs1k-webgpu.wasm":
    "0342d0b660eb0d0415d37e4689c77bdab6dd2ca89cf5a44a0623d4c962e67c77",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertModelVersionMatchesWebLLM() {
  const webllmSrc = readFileSync(
    resolve(ROOT, "node_modules/@mlc-ai/web-llm/lib/index.js"),
    "utf8",
  );
  const match = webllmSrc.match(/const modelVersion = "([^"]+)"/);
  if (!match) {
    throw new Error(
      "Could not find modelVersion in @mlc-ai/web-llm; its internals may " +
        "have changed. Re-derive scripts/model-libs.mjs against it.",
    );
  }
  if (!MODEL_LIB_URL_PREFIX.includes(`/${match[1]}/`)) {
    throw new Error(
      `Bundled model libs are pinned for a different web-llm model version ` +
        `(installed package wants "${match[1]}", pinned URL is ` +
        `${MODEL_LIB_URL_PREFIX}). Update MODEL_LIB_URL_PREFIX and ` +
        `MODEL_LIB_SHA256 for the new version.`,
    );
  }
}

export async function ensureModelLibs() {
  assertModelVersionMatchesWebLLM();
  mkdirSync(MODEL_LIB_CACHE_DIR, { recursive: true });

  const libs = [];
  for (const model of WEBLLM_MODELS) {
    const file = model.lib;
    const expected = MODEL_LIB_SHA256[file];
    if (!file || !expected) {
      throw new Error(
        `No bundled model lib pinned for ${model.id}; add a \`lib\` filename ` +
          `in lib/constants.js and its hash in scripts/model-libs.mjs.`,
      );
    }

    const path = resolve(MODEL_LIB_CACHE_DIR, file);
    if (existsSync(path) && sha256(readFileSync(path)) === expected) {
      libs.push({ file, path });
      continue;
    }

    const url = MODEL_LIB_URL_PREFIX + file;
    console.log(`[model-libs] downloading ${file}...`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== expected) {
      throw new Error(
        `Integrity check FAILED for ${file}: expected ${expected}, got ` +
          `${actual}. Upstream content changed; verify it deliberately ` +
          `before updating the pinned hash.`,
      );
    }
    writeFileSync(path, bytes);
    libs.push({ file, path });
  }
  return libs;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  ensureModelLibs()
    .then((libs) => {
      console.log(`[model-libs] ${libs.length} model libs verified in cache.`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
