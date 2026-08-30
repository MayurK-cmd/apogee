import test from "node:test";
import assert from "node:assert";
import { cyrb53, sha256Hex } from "../../lib/util/hash.js";

test("cyrb53 is deterministic for the same input", () => {
  assert.strictEqual(cyrb53("hello world"), cyrb53("hello world"));
  assert.strictEqual(cyrb53(""), cyrb53(""));
});

test("cyrb53 produces distinct hashes for distinct inputs", () => {
  assert.notStrictEqual(cyrb53("hello"), cyrb53("world"));
  assert.notStrictEqual(cyrb53("a"), cyrb53("b"));
  assert.notStrictEqual(cyrb53("ab"), cyrb53("ba"));
});

test("cyrb53 returns a non-empty string", () => {
  assert.strictEqual(typeof cyrb53("anything"), "string");
  assert.ok(cyrb53("anything").length > 0);
});

test("cyrb53 handles null, undefined, and empty string inputs", () => {
  assert.strictEqual(cyrb53(null), cyrb53(""));
  assert.strictEqual(cyrb53(undefined), cyrb53(""));
  assert.strictEqual(cyrb53(0), cyrb53("0"));
  assert.ok(cyrb53(null).length > 0);
});

test("sha256Hex hashes a string to a 32-character hex digest", async () => {
  const hash = await sha256Hex("hello world");
  assert.match(hash, /^[0-9a-f]{32}$/);
});

test("sha256Hex is deterministic for the same input", async () => {
  assert.strictEqual(
    await sha256Hex("same input"),
    await sha256Hex("same input"),
  );
});

test("sha256Hex returns a known digest for a known input", async () => {
  const hash = await sha256Hex("abc");
  assert.strictEqual(hash, "ba7816bf8f01cfea414140de5dae2223");
});

test("sha256Hex handles null and undefined inputs", async () => {
  const emptyHash = await sha256Hex("");
  assert.strictEqual(await sha256Hex(null), emptyHash);
  assert.strictEqual(await sha256Hex(undefined), emptyHash);
});
