// Direct fetch-based Ollama HTTP client, replaces apogee-backend's
// services/llmService.js (which used the `ollama` npm package) now that
// there's no Node process to install that package into. Talks straight to
// Ollama's own HTTP API (POST /api/chat, GET /api/tags).

// Not exported: only ever thrown/caught within this module.
class OllamaError extends Error {}

function connectError(host, err) {
  // The extension strips the Origin header on localhost requests via a
  // declarativeNetRequest rule (see rules/ollama-cors.json), so Ollama's CORS
  // check passes without OLLAMA_ORIGINS; a failure here is almost always that
  // Ollama isn't running or is listening on a different host/port.
  return new OllamaError(
    `Could not connect to Ollama at ${host}. Is it running and listening on ` +
      `that address? Error: ${err?.message ?? err}`,
  );
}

/**
 * Async-generator yielding response tokens from Ollama's streaming
 * /api/chat endpoint (newline-delimited JSON). Throws OllamaError on failure.
 */
export async function* chatStream(
  host,
  model,
  prompt,
  { signal, keepAlive = "5m", system } = {},
) {
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];
  let response;
  try {
    response = await fetch(`${host.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        think: false,
        keep_alive: keepAlive,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError")
      throw new OllamaError("Generation was cancelled.");
    throw connectError(host, err);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    let message = detail;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error) message = parsed.error;
    } catch {
      // not JSON, use raw text
    }
    throw new OllamaError(
      `Ollama returned an error for model '${model}': ${message || response.status}`,
    );
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

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const parsed = JSON.parse(line);
        if (parsed.error) {
          throw new OllamaError(
            `Ollama returned an error for model '${model}': ${parsed.error}`,
          );
        }
        const text = parsed.message?.content;
        if (text) yield text;
      }
    }
    const trailing = buffer.trim();
    if (trailing) {
      const parsed = JSON.parse(trailing);
      const text = parsed.message?.content;
      if (text) yield text;
    }
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (err?.name === "AbortError" || signal?.aborted) {
      throw new OllamaError("Generation was cancelled.");
    }
    // A malformed NDJSON line throws SyntaxError from JSON.parse above: the
    // connection itself was fine, so don't misreport it as "Could not connect
    // to Ollama..." (which sends users chasing a networking problem that
    // isn't there).
    if (err instanceof SyntaxError) {
      throw new OllamaError(
        `Ollama sent a malformed response for model '${model}': ${err.message}`,
      );
    }
    throw connectError(host, err);
  }
}

/** Mirrors apogee-backend/src/routes/health.js's GET /health. */
export async function checkHealth(host, timeoutMs = 3000) {
  try {
    const response = await fetch(`${host.replace(/\/+$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { connected: false, models: [] };
    const data = await response.json();
    const models = Array.isArray(data.models)
      ? data.models.map((m) => m.model || m.name).filter(Boolean)
      : [];
    return { connected: true, models };
  } catch {
    return { connected: false, models: [] };
  }
}
