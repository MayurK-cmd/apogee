import test from "node:test";
import assert from "node:assert";
import { validateOllamaHost } from "../../lib/util/ollamaHost.js";

test("validateOllamaHost accepts default Ollama host http://127.0.0.1:11434", () => {
  const result = validateOllamaHost("http://127.0.0.1:11434");
  assert.strictEqual(result, "http://127.0.0.1:11434");
});

test("validateOllamaHost accepts default Ollama host http://localhost:11434", () => {
  const result = validateOllamaHost("http://localhost:11434");
  assert.strictEqual(result, "http://localhost:11434");
});

test("validateOllamaHost defaults missing port to 11434 for 127.0.0.1 and localhost", () => {
  assert.strictEqual(
    validateOllamaHost("http://127.0.0.1"),
    "http://127.0.0.1:11434",
  );
  assert.strictEqual(
    validateOllamaHost("http://localhost"),
    "http://localhost:11434",
  );
});

test("validateOllamaHost accepts custom valid numeric ports on loopback and strips trailing slashes", () => {
  assert.strictEqual(
    validateOllamaHost("http://127.0.0.1:11435/"),
    "http://127.0.0.1:11435",
  );
  assert.strictEqual(
    validateOllamaHost("http://localhost:8080///"),
    "http://localhost:8080",
  );
});

test("validateOllamaHost rejects non-http protocols", () => {
  assert.throws(
    () => validateOllamaHost("https://127.0.0.1:11434"),
    /Disallowed Ollama protocol: https:/,
  );
  assert.throws(
    () => validateOllamaHost("ftp://127.0.0.1:11434"),
    /Disallowed Ollama protocol: ftp:/,
  );
});

test("validateOllamaHost rejects non-loopback hostnames and remote IPs", () => {
  assert.throws(
    () => validateOllamaHost("http://example.com:11434"),
    /Disallowed Ollama host: example.com/,
  );
  assert.throws(
    () => validateOllamaHost("http://192.168.1.100:11434"),
    /Disallowed Ollama host: 192.168.1.100/,
  );
});

test("validateOllamaHost rejects invalid or out-of-range port numbers", () => {
  assert.throws(
    () => validateOllamaHost("http://127.0.0.1:0"),
    /Invalid Ollama (host|port)/,
  );
  assert.throws(
    () => validateOllamaHost("http://127.0.0.1:70000"),
    /Invalid Ollama (host|port)/,
  );
});

test("validateOllamaHost rejects malformed URLs", () => {
  assert.throws(
    () => validateOllamaHost("not a valid url"),
    /Invalid Ollama host/,
  );
});
