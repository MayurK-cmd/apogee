import { UserFacingError } from "../util/userError.js";

class LlamaCppError extends UserFacingError {}

/**
 * llama-server's context window is set by its `-c` launch flag, not by the
 * model, so a model name says nothing about it. When neither `/props` nor
 * `/v1/models` reports the running value, callers fall back to this: low
 * enough to be safe on a modestly configured server.
 */
export const DEFAULT_CONTEXT_TOKENS = 8192;

const SSE_DONE = "[DONE]";

function connectError(host, err) {
  return new LlamaCppError(
    `Could not connect to llama.cpp at ${host}. Is llama-server running and ` +
      `listening on that address? Error: ${err?.message ?? err}`,
  );
}

// Every llama-server failure comes back as {error:{message,type,code}}, but a
// server_error's message can be a raw C++ exception dump ("[json.exception.
// parse_error.101] parse error at line 1, column 2..."), which means nothing
// to the person reading it. Request-shaped errors (400, 404) are written for
// a caller, so those pass through.
function envelopeMessage(error, model) {
  if (error?.type === "server_error") {
    return (
      `llama.cpp failed while handling the request for model '${model}'. ` +
      `Check the llama-server console for details.`
    );
  }
  const detail = typeof error?.message === "string" ? error.message : null;
  return detail
    ? `llama.cpp returned an error for model '${model}': ${detail}`
    : null;
}

function httpError(body, status, model) {
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {}
  const described = envelopeMessage(parsed?.error, model);
  return new LlamaCppError(
    described ||
      `llama.cpp returned an error for model '${model}': ${body || status}`,
  );
}

// An SSE event may carry several lines, of which only `data:` ones are
// payload. Anything else (a `:` keepalive comment, an `event:` name) is
// skipped rather than parsed, so a server version that starts emitting them
// cannot break the stream.
function dataPayloadsOf(block) {
  const payloads = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    payloads.push(line.slice(5).trim());
  }
  return payloads;
}

function readEventBlock(block, model) {
  const tokens = [];
  for (const payload of dataPayloadsOf(block)) {
    if (payload === SSE_DONE) return { tokens, done: true };
    if (!payload) continue;

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      throw new LlamaCppError(
        `llama.cpp sent a malformed response for model '${model}': ${err.message}`,
      );
    }

    if (parsed?.error) {
      throw httpError(payload, "streamed error", model);
    }

    const content = parsed?.choices?.[0]?.delta?.content;
    // The opening chunk announces the assistant role with `content: null`, and
    // the closing chunk carries finish_reason with an empty delta. Checking the
    // type skips both, while still passing a single-space token through, which
    // a truthiness check would drop.
    if (typeof content === "string" && content !== "") tokens.push(content);
  }
  return { tokens, done: false };
}

export async function* chatStream(
  host,
  model,
  prompt,
  { signal, system } = {},
) {
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];

  const base = host.replace(/\/+$/, "");

  let response;
  try {
    response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError")
      throw new LlamaCppError("Generation was cancelled.");
    throw connectError(base, err);
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {}
    throw httpError(body, response.status, model);
  }

  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const { tokens, done: finished } = readEventBlock(block, model);
        yield* tokens;
        if (finished) return;
      }
    }

    // `data: [DONE]` arrives with no trailing blank line, so the final event is
    // still sitting in the buffer once the reader finishes. Without this flush
    // the sentinel is never read. ollamaClient.js flushes its last NDJSON line
    // for the same reason.
    const trailing = buffer.trim();
    if (trailing) {
      const { tokens } = readEventBlock(trailing, model);
      yield* tokens;
    }
  } catch (err) {
    if (err instanceof LlamaCppError) throw err;
    if (err?.name === "AbortError" || signal?.aborted) {
      throw new LlamaCppError("Generation was cancelled.");
    }
    throw connectError(base, err);
  }
}

async function getJson(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function positiveInt(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Whether llama-server is reachable, which model(s) it is serving, and the
 * context window it is actually running with.
 *
 * `/health` answering is the whole of "is it up". The two lookups after it
 * only enrich that answer, so a server with `/props` disabled
 * (`endpoint_props: false`) or an unfamiliar `/v1/models` shape still reports
 * as connected. `contextTokens` is null when neither reported one, leaving the
 * caller to apply DEFAULT_CONTEXT_TOKENS rather than having a guess handed to
 * it as though it were detected.
 */
export async function checkHealth(host, timeoutMs = 3000) {
  const base = host.replace(/\/+$/, "");
  const disconnected = { connected: false, models: [], contextTokens: null };

  let health;
  try {
    health = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return disconnected;
  }
  if (!health.ok) return disconnected;

  const [props, modelList] = await Promise.all([
    getJson(`${base}/props`, timeoutMs),
    getJson(`${base}/v1/models`, timeoutMs),
  ]);

  const entries = Array.isArray(modelList?.data) ? modelList.data : [];
  const models = entries
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string" && id);

  const contextTokens =
    positiveInt(props?.default_generation_settings?.n_ctx) ??
    positiveInt(entries[0]?.meta?.n_ctx);

  return { connected: true, models, contextTokens };
}
