const ALLOWED_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_OLLAMA_PORT = "11434";

export function validateOllamaHost(host) {
  let url;
  try {
    url = new URL(host);
  } catch {
    throw new Error("Invalid Ollama host");
  }
  if (url.protocol !== "http:") {
    throw new Error(`Disallowed Ollama protocol: ${url.protocol}`);
  }
  if (!ALLOWED_OLLAMA_HOSTS.has(url.hostname)) {
    throw new Error(`Disallowed Ollama host: ${url.hostname}`);
  }
  if (!url.port) {
    url.port = DEFAULT_OLLAMA_PORT;
  }
  const portNum = Number(url.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error(`Invalid Ollama port: ${url.port}`);
  }
  return url.toString().replace(/\/+$/, "");
}
