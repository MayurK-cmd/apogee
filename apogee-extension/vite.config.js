import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, readFileSync, writeFileSync } from "fs";
import { ensureModelLibs } from "./scripts/model-libs.mjs";

function copyStaticPlugin(targetBrowser) {
  return {
    name: "copy-static",
    closeBundle() {
      const dist = resolve(__dirname, `dist/${targetBrowser}`);

      const manifestPath = resolve(__dirname, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

      if (targetBrowser === "firefox") {
        // Remove offscreen permission and simplify CSP for Firefox. Still
        // needs 'wasm-unsafe-eval' (Transformers.js's WASM engine) and the
        // Hugging Face domains (model weights, see lib/transformersEngine.js)
        // that Chrome's CSP already carries for WebLLM's own model fetching.
        // connect-src 'self' lets onnxruntime fetch its bundled WASM runtime
        // same-origin (see lib/onnxWasm.js); no jsDelivr entry is needed since
        // that binary is no longer fetched from a CDN.
        // sponsor.ajay.app (SponsorBlock segment lookup, see
        // fetchSponsorBlockSegments in background/service-worker.js) must be
        // here too: on Firefox the background script is a real extension
        // page, so its fetches ARE bound by this CSP, unlike Chrome's
        // service worker, and without the entry the lookup silently fails
        // into the local phrase heuristic.
        // No worker-src change needed here (unlike the earlier, reverted
        // wllama attempt): Transformers.js's WASM backend never spawns a
        // Worker (onnxruntime-web's env.wasm.proxy is hardcoded false by the
        // library), so it isn't subject to that restriction at all.
        manifest.permissions = manifest.permissions.filter(
          (p) => p !== "offscreen",
        );
        manifest.content_security_policy = {
          extension_pages:
            "script-src 'self' 'wasm-unsafe-eval'; default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://sponsor.ajay.app; img-src 'self' data:; font-src 'self'; style-src 'self'",
        };
        if (manifest.background) {
          delete manifest.background.service_worker;
        }
        // Chrome-only key (Firefox has no offscreen API, so no floor to
        // declare); browser_specific_settings.gecko already covers Firefox.
        delete manifest.minimum_chrome_version;
      } else {
        // Chrome MV3 doesn't support background.scripts
        if (manifest.background) {
          delete manifest.background.scripts;
        }
      }

      writeFileSync(
        resolve(dist, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      cpSync(resolve(__dirname, "assets"), resolve(dist, "assets"), {
        recursive: true,
      });

      cpSync(resolve(__dirname, "content"), resolve(dist, "content"), {
        recursive: true,
      });
    },
  };
}

// Chrome only (Firefox has no WebLLM/offscreen at all): download (cached) and
// hash-verify the WebLLM model-library WASM kernels, then ship them in the
// package under assets/model-libs/ so no executable code is fetched remotely
// at runtime. See scripts/model-libs.mjs for the pinned URLs/hashes and
// offscreen.js's ensureEngine for the runtime side.
function bundleModelLibsPlugin(targetBrowser) {
  let libs = [];
  return {
    name: "bundle-webllm-model-libs",
    async buildStart() {
      if (targetBrowser !== "chrome") return;
      libs = await ensureModelLibs();
    },
    closeBundle() {
      if (targetBrowser !== "chrome") return;
      for (const { file, path } of libs) {
        cpSync(
          path,
          resolve(__dirname, `dist/chrome/assets/model-libs/${file}`),
        );
      }
    },
  };
}

export default defineConfig(() => {
  const targetBrowser = process.env.TARGET_BROWSER || "chrome";
  const isFirefox = targetBrowser === "firefox";

  const input = {
    popup: resolve(__dirname, "popup/popup.html"),
    "background/service-worker": resolve(
      __dirname,
      "background/service-worker.js",
    ),
    // pdf.js's worker, loaded at runtime via chrome.runtime.getURL("pdf.worker.js")
    // from lib/pdfExtract.js. Built as its own entry (not bundled into
    // service-worker.js) since it must run as a real Worker script.
    "pdf.worker": resolve(
      __dirname,
      "node_modules/pdfjs-dist/build/pdf.worker.mjs",
    ),
  };

  if (!isFirefox) {
    input["offscreen/offscreen"] = resolve(
      __dirname,
      "offscreen/offscreen.html",
    );
  }

  return {
    // Relative asset URLs in the emitted HTML (Vite's default base "/" emits
    // root-absolute "/popup.js"): both resolve fine inside a packed
    // extension, but root-absolute paths break the documented UI-iteration
    // workflow of opening a built dist/*/popup/popup.html directly via
    // file:// (see the mock.js note at the top of popup.js).
    base: "./",
    define: {
      "process.env.TARGET_BROWSER": JSON.stringify(targetBrowser),
    },
    build: {
      outDir: `dist/${targetBrowser}`,
      emptyOutDir: true,
      minify: false,
      // Vite's dynamic-import preload helper unconditionally touches
      // `window` (to track/report chunk preload errors), which doesn't
      // exist in background/service-worker.js's ServiceWorkerGlobalScope.
      // lib/embeddings.js's `await import("@huggingface/transformers")`
      // runs from there, so without this every embedding call threw
      // "window is not defined" before ever reaching transformers.js.
      // Not needed anyway: an extension loads all its own files from local
      // disk, there's no network round-trip for modulepreload to save.
      modulePreload: false,
      // Default esbuild target (~Chrome 87/Firefox 78) predates top-level
      // await. The extension already requires MV3 offscreen (Chrome 109+)
      // and WebGPU-capable browsers, so target the browsers this actually
      // runs on instead.
      target: "es2022",
      rollupOptions: {
        input,
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            // assetInfo.name is deprecated in Rollup 4 in favor of the
            // (possibly multi-entry) .names array.
            const name = assetInfo.names?.[0] ?? assetInfo.name;
            // Keep CSS alongside its entry
            if (name?.endsWith(".css")) {
              return "[name][extname]";
            }
            // onnxruntime-web's WASM runtime (pulled in transitively via
            // @huggingface/transformers, see lib/embeddings.js) is emitted with
            // a stable, hash-free name so lib/embeddings.js and
            // lib/transformersEngine.js can point onnxruntime's wasmPaths at the
            // bundled copy via chrome.runtime.getURL(); it ships in the package
            // rather than being fetched from a CDN at runtime (a supply-chain
            // hole and a Chrome Web Store / AMO "no remotely loaded code"
            // violation). The referenced filename in those two files must match
            // this base name.
            if (/^ort-wasm.*\.wasm$/.test(name ?? "")) {
              return "assets/[name][extname]";
            }
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
    plugins: [
      copyStaticPlugin(targetBrowser),
      bundleModelLibsPlugin(targetBrowser),

      {
        name: "strip-crossorigin",
        enforce: "post",
        generateBundle(_options, bundle) {
          for (const [, asset] of Object.entries(bundle)) {
            if (asset.type === "asset" && asset.fileName.endsWith(".html")) {
              // Drop modulepreload links entirely rather than rewriting them
              // to `rel="preload" as="script"` (the old behavior): a classic
              // script preload of a *module* is a mismatched destination, so
              // Chrome double-fetches it and logs a "preloaded but not used"
              // warning. Extension files load from local disk; preloading
              // saves nothing here anyway (same reason vite.config.js sets
              // modulePreload: false for the polyfill).
              asset.source = asset.source
                .replace(/\s*<link rel="modulepreload"[^>]*>/g, "")
                .replace(/ crossorigin/g, "");
            }
          }
        },
      },
    ],
  };
});
