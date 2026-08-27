# Apogee Browser Support and Compatibility Reference

Apogee ships two builds: a Chromium build (`dist/chrome`, Manifest V3 with an offscreen document for WebGPU) and a Firefox build (`dist/firefox`, no offscreen document). Anything Chromium based accepts the same build.

## Browser Support Matrix

The table below outlines supported feature sets, runtime engine availability, and testing status across web browsers.

| Browser | WebLLM (In-Browser AI, WebGPU) | Transformers.js (In-Browser AI, WASM) | Local Ollama | Notes |
| --- | --- | --- | --- | --- |
| Chrome 116+ | Yes, default | Yes, opt-in in Settings | Yes | Primary target, most tested; popup and persistent side panel UI |
| Edge 116+ | Yes, default | Yes, opt-in in Settings | Yes | Chromium based, same engine and side panel support as Chrome |
| Dia | Yes, default | Yes, opt-in in Settings | Yes | Chromium based |
| Brave | Should work | Should work | Yes | Chromium based; WebGPU may need enabling in `brave://flags`, not independently verified |
| Opera / Opera GX | Should work | Should work | Yes | Chromium based, not independently verified |
| Vivaldi | Should work | Should work | Yes | Chromium based, not independently verified |
| Arc | Should work | Should work | Yes | Chromium based, not independently verified |
| Firefox 140+ | No | Yes, default | Yes | Firefox WebExtensions implementation has no `browser.offscreen` API, which WebLLM needs to run WebGPU outside a visible tab (a service worker cannot access WebGPU directly). Transformers.js needs neither WebGPU nor a Worker, so it runs directly in Firefox background page instead, and is the default in-browser provider there. The Firefox build declares `strict_min_version: 140.0` (needed for the manifest `data_collection_permissions` key); older Firefox will refuse to install it rather than fail silently. |
| Safari | No | No | No | Apogee does not currently build or ship a Safari extension (a separate packaging toolchain from Chrome and Firefox); not evaluated regardless of Safari own WebGPU support. |

## Hardware and Compatibility Notes

See the MDN WebGPU API browser compatibility table for exact per-browser and per-OS WebGPU version support; it is a fast-moving target and a better source of truth than a number hardcoded here. A GPU with WebGPU support (most GPUs from the last several years) is required for In-Browser (WebLLM) mode specifically. Local Ollama mode has no GPU requirement of its own beyond whatever Ollama itself needs.
