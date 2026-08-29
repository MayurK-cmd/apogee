import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

test("runBackgroundSummarize only calls startLocalHttpStream once for Local Ollama (#151)", async () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );

  // Extract runBackgroundSummarize function body
  const fnMatch = swCode.match(
    /async function runBackgroundSummarize[\s\S]*?\n\}/,
  );
  assert.ok(fnMatch, "runBackgroundSummarize function found");
  const fnBody = fnMatch[0];

  // Count occurrences of startLocalHttpStream calls inside runBackgroundSummarize
  const callMatches = fnBody.match(/startLocalHttpStream\(/g) || [];
  // There should be exactly 2 startLocalHttpStream calls: one for PROVIDERS.LOCAL and one for PROVIDERS.LLAMACPP
  assert.strictEqual(
    callMatches.length,
    2,
    "runBackgroundSummarize should have exactly 2 startLocalHttpStream calls (one for LOCAL, one for LLAMACPP)",
  );

  // In the streamId initialization block, there should be NO startLocalHttpStream call
  const initBlockMatch = fnBody.match(
    /let streamId;[\s\S]*?registerStreamJob\(streamId/,
  );
  assert.ok(initBlockMatch, "streamId initialization block found");
  assert.ok(
    !initBlockMatch[0].includes("startLocalHttpStream("),
    "streamId init block should not call startLocalHttpStream before registerStreamJob",
  );
});
