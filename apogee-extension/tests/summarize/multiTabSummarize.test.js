import test from "node:test";
import assert from "node:assert";
import { PROVIDERS } from "../../lib/constants.js";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

const { chrome } = createExtensionApiMock({
  settings: {
    provider: PROVIDERS.LOCAL,
    localModel: "qwen3:8b",
    ollamaHost: "http://127.0.0.1:11434",
    responseFormat: "bullets",
    summaryLanguage: "en",
  },
});
chrome.offscreen = {
  createDocument: async () => {},
  closeDocument: async () => {},
};
chrome.runtime.getContexts = async () => [
  { contextType: "OFFSCREEN_DOCUMENT" },
];
chrome.alarms = {
  create: () => {},
  clear: () => {},
};
globalThis.chrome = chrome;

const { summarizeMultiTab } =
  await import("../../background/service-worker.js");

test("PROVIDERS defines LOCAL and not OLLAMA", () => {
  assert.strictEqual(PROVIDERS.LOCAL, "local");
  assert.strictEqual(PROVIDERS.OLLAMA, undefined);
});

test("summarizeMultiTab returns null when no tabs have extractable content", async () => {
  const result = await summarizeMultiTab([]);
  assert.strictEqual(result, null);
});

test("summarizeMultiTab handles multi-tab extraction and generates summary for LOCAL provider", async () => {
  await chrome.storage.local.set({
    settings: {
      provider: PROVIDERS.LOCAL,
      localModel: "qwen3:8b",
      ollamaHost: "http://127.0.0.1:11434",
      responseFormat: "bullets",
      summaryLanguage: "auto",
    },
  });

  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async (_tabId, _msg) => ({
    content: "Article content from tab",
    title: "Test Tab Title",
    type: "article",
  });

  const fakeTabs = [
    { id: 1, url: "https://example.com/page1", title: "Page 1" },
    { id: 2, url: "https://example.com/page2", title: "Page 2" },
  ];

  const originalFetch = globalThis.fetch;
  const requestedPrompts = [];

  globalThis.fetch = async (url, options) => {
    if (url.toString().includes("11434")) {
      const body = JSON.parse(options.body);
      const prompt = body.prompt || body.messages?.[0]?.content || "";
      requestedPrompts.push(prompt);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                message: {
                  role: "assistant",
                  content:
                    "- Bullet point 1 explaining the test in detail.\n- Bullet point 2 explaining more.\n",
                },
                done: true,
              }) + "\n",
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const result = await summarizeMultiTab(fakeTabs);
    assert.ok(result, "should return a result");
    assert.ok(requestedPrompts.length >= 1, "should call Ollama over loopback");
    assert.match(
      requestedPrompts[0],
      /summarizing multiple tabs simultaneously/i,
    );
    assert.match(requestedPrompts[0], /https:\/\/example\.com\/page1/);
    assert.match(requestedPrompts[0], /https:\/\/example\.com\/page2/);
    assert.match(result.summary, /Bullet point/);
    assert.strictEqual(result.pageData.type, "multi-tab");
    assert.strictEqual(result.pageData.tabs.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("summarizeMultiTab handles multi-tab summary for LLAMACPP provider", async () => {
  await chrome.storage.local.set({
    settings: {
      provider: PROVIDERS.LLAMACPP,
      llamaHost: "http://127.0.0.1:8080",
      llamaModel: "custom-model",
      llamaApiKey: "secret-key",
      responseFormat: "bullets",
      summaryLanguage: "auto",
    },
  });

  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async (_tabId, _msg) => ({
    content: "Tab content text",
    title: "Llama Tab",
    type: "article",
  });

  const fakeTabs = [
    { id: 1, url: "https://example.com/tab", title: "Llama Tab" },
  ];
  const originalFetch = globalThis.fetch;
  const requestedPrompts = [];
  let capturedAuth = "";

  globalThis.fetch = async (url, options) => {
    if (url.toString().includes("8080")) {
      capturedAuth =
        options.headers?.["Authorization"] ||
        options.headers?.["authorization"] ||
        "";
      const body = JSON.parse(options.body);
      requestedPrompts.push(body.prompt || body.messages?.[0]?.content || "");
      const ssePayload =
        "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "- Llama summary bullet point.\n" } }],
        }) +
        "\n\ndata: [DONE]\n\n";
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const result = await summarizeMultiTab(fakeTabs);
    assert.ok(result);
    assert.ok(requestedPrompts.length >= 1);
    assert.match(
      requestedPrompts[0],
      /summarizing multiple tabs simultaneously/i,
    );
    assert.strictEqual(capturedAuth, "Bearer secret-key");
    assert.match(result.summary, /Llama summary/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("summarizeMultiTab handles WebLLM provider by messaging offscreen generate-text", async () => {
  await chrome.storage.local.set({
    settings: {
      provider: PROVIDERS.WEBLLM,
      webllmModel: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
      responseFormat: "bullets",
      customInstructions: "Focus on technical benchmarks.",
      summaryLanguage: "en",
    },
  });

  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async (_tabId, _msg) => ({
    content: "WebLLM tab content text",
    title: "WebLLM Tab",
    type: "article",
  });

  let offscreenMessage = null;
  chrome.runtime.sendMessage = async (msg) => {
    if (msg.target === "offscreen" && msg.action === "generate-text") {
      offscreenMessage = msg;
      return { text: "- Synthesized WebLLM bullet summary." };
    }
    return { summary: "" };
  };

  const fakeTabs = [
    { id: 1, url: "https://example.com/webllm", title: "WebLLM Tab" },
  ];
  const result = await summarizeMultiTab(fakeTabs);

  assert.ok(result);
  assert.ok(offscreenMessage);
  assert.strictEqual(offscreenMessage.action, "generate-text");
  assert.strictEqual(offscreenMessage.payload.provider, "webllm");
  assert.match(
    offscreenMessage.payload.prompt,
    /ADDITIONAL INSTRUCTIONS FROM THE USER:/,
  );
  assert.match(
    offscreenMessage.payload.prompt,
    /Focus on technical benchmarks\./,
  );
  assert.strictEqual(result.summary, "- Synthesized WebLLM bullet summary.");
});
