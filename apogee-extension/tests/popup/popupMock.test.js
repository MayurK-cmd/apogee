import test from "node:test";
import assert from "node:assert";
import { parseHTML } from "linkedom";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { toUserMessage } from "../../lib/util/userError.js";
import { getOptionalOriginsForUrl } from "../../lib/util/permissions.js";

test("extensionApiMock simulates chrome.storage.local operations", async () => {
  const { chrome, getStorageData } = createExtensionApiMock({
    provider: "webllm",
    model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  });

  const settings = await chrome.storage.local.get(["provider", "model"]);
  assert.strictEqual(settings.provider, "webllm");
  assert.strictEqual(settings.model, "Llama-3.2-1B-Instruct-q4f16_1-MLC");

  await chrome.storage.local.set({ provider: "ollama", model: "llama3.2:3b" });
  const updated = getStorageData();
  assert.strictEqual(updated.provider, "ollama");
  assert.strictEqual(updated.model, "llama3.2:3b");
});

test("extensionApiMock handles message routing between runtime components", async () => {
  const { chrome } = createExtensionApiMock();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ping") {
      sendResponse({ status: "pong", senderId: sender.id });
      return true;
    }
  });

  const response = await chrome.runtime.sendMessage({ type: "ping" });
  assert.strictEqual(response.status, "pong");
  assert.strictEqual(response.senderId, "mock-extension-id-12345");
});

test("extensionApiMock validates permission requests and tab queries", async () => {
  const { chrome } = createExtensionApiMock();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  assert.strictEqual(tabs.length, 1);
  assert.strictEqual(tabs[0].url, "https://example.com/article");

  const origins = getOptionalOriginsForUrl(tabs[0].url);
  assert.deepEqual(origins, []);

  const hasPerm = await chrome.permissions.contains({
    origins: ["*://*.youtube.com/*"],
  });
  assert.strictEqual(hasPerm, true);
});

test("extensionApiMock simulates user error handling and state sync", () => {
  const rawError = new Error("ONNX Runtime WASM buffer allocation failed");
  const userMsg = toUserMessage(rawError);
  assert.strictEqual(
    userMsg,
    "Memory limit reached while processing this document. Try a smaller model or reducing context size.",
  );
});

test("Shadow DOM encapsulation helper creates custom host element", () => {
  const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
  const host = document.createElement("apogee-highlight-root");
  assert.ok(host);
  assert.strictEqual(host.tagName.toLowerCase(), "apogee-highlight-root");
});
