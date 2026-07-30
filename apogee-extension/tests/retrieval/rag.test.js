import test from "node:test";
import assert from "node:assert";

import {
  retrieveRelevantContent,
  findBestPassage,
  selectSalientChunks,
} from "../../lib/retrieval/rag.js";

// Fake 2-D "embedding": [1,0] if the text mentions banana, [0,1] if it
// mentions carrot, [0,0] otherwise. A question about banana then scores
// highest (dot product) against banana-containing chunks, same shape as
// real cosine similarity between normalized vectors.
function fakeEmbed(texts) {
  return texts.map((t) => {
    const lower = t.toLowerCase();
    return [lower.includes("banana") ? 1 : 0, lower.includes("carrot") ? 1 : 0];
  });
}

test("retrieveRelevantContent returns short content unchanged without embedding", async () => {
  const content = "Short page content.";
  let calls = 0;
  const embedTextsFn = (texts) => {
    calls++;
    return fakeEmbed(texts);
  };

  const result = await retrieveRelevantContent(
    { content, question: "anything?" },
    { embedTextsFn },
  );

  assert.equal(result, content);
  assert.equal(calls, 0);
});

test("retrieveRelevantContent picks the chunk relevant to the question", async () => {
  const banana = "banana ".repeat(200);
  const carrot = "carrot ".repeat(200);
  const filler = "lorem ipsum dolor sit amet ".repeat(150);
  const content = `${filler}${banana}${filler}${carrot}${filler}`;

  const result = await retrieveRelevantContent(
    {
      content,
      question: "What about banana?",
      maxContextChars: 500,
      topK: 1,
    },
    { embedTextsFn: fakeEmbed },
  );

  assert.ok(result.toLowerCase().includes("banana"));
  assert.ok(!result.toLowerCase().includes("carrot"));
});

test("retrieveRelevantContent reuses cached chunk embeddings across questions", async () => {
  const kiwi = "kiwi ".repeat(200);
  const mango = "mango ".repeat(200);
  const filler = "the quick brown fox jumps over ".repeat(150);
  const content = `${filler}${kiwi}${filler}${mango}${filler}`;

  let indexBuildCalls = 0;
  const embedTextsFn = (texts) => {
    if (texts.length > 1) indexBuildCalls++;
    return fakeEmbed(texts);
  };

  await retrieveRelevantContent(
    { content, question: "kiwi?", maxContextChars: 500, topK: 1 },
    { embedTextsFn },
  );
  await retrieveRelevantContent(
    { content, question: "mango?", maxContextChars: 500, topK: 1 },
    { embedTextsFn },
  );

  assert.equal(indexBuildCalls, 1);
});

test("retrieveRelevantContent falls back to truncation if embedding fails", async () => {
  const content = "x".repeat(7000);
  const embedTextsFn = () => {
    throw new Error("model unavailable");
  };

  const result = await retrieveRelevantContent(
    { content, question: "anything?", maxContextChars: 100 },
    { embedTextsFn },
  );

  assert.ok(result.includes("[...content truncated...]"));
  assert.ok(result.length <= 100 + 30);
});

// Orthogonal unit vectors per topic keyword, for exercising salience+diversity.
function topicEmbed(texts) {
  return texts.map((t) => {
    const l = t.toLowerCase();
    return [
      l.includes("apple") ? 1 : 0,
      l.includes("banana") ? 1 : 0,
      l.includes("cherry") ? 1 : 0,
    ];
  });
}

test("selectSalientChunks returns chunks unchanged when already within budget", async () => {
  const chunks = ["a", "b"];
  const result = await selectSalientChunks(chunks, 5, {
    embedTextsFn: topicEmbed,
  });
  assert.strictEqual(result, chunks);
});

test("selectSalientChunks covers the document's distinct topics instead of keeping the first N", async () => {
  // Three apple chunks up front, then banana and cherry. Head-truncation to 3
  // would keep only apples; salience+diversity must instead span all 3 topics,
  // returned in original order.
  const chunks = [
    "apple one",
    "apple two",
    "apple three",
    "banana content",
    "cherry content",
  ];
  const result = await selectSalientChunks(chunks, 3, {
    embedTextsFn: topicEmbed,
  });

  assert.strictEqual(result.length, 3);
  assert.ok(
    result.some((c) => c.includes("banana")),
    "must include the banana topic, not only apples",
  );
  assert.ok(
    result.some((c) => c.includes("cherry")),
    "must include the cherry topic, not only apples",
  );
  // Original document order is preserved.
  assert.deepStrictEqual(
    result,
    [...result].sort((a, b) => chunks.indexOf(a) - chunks.indexOf(b)),
  );
});

test("selectSalientChunks returns null if embedding fails (caller falls back)", async () => {
  const result = await selectSalientChunks(["a", "b", "c"], 2, {
    embedTextsFn: () => {
      throw new Error("model unavailable");
    },
  });
  assert.strictEqual(result, null);
});

test("findBestPassage returns the chunk most similar to the query, with a score", async () => {
  const banana = "banana ".repeat(200);
  const carrot = "carrot ".repeat(200);
  const filler = "lorem ipsum dolor sit amet ".repeat(150);
  const content = `${filler}${banana}${filler}${carrot}${filler}`;

  const result = await findBestPassage(
    { content, query: "Tell me about banana" },
    { embedTextsFn: fakeEmbed },
  );

  assert.ok(result);
  assert.ok(result.chunk.toLowerCase().includes("banana"));
  assert.ok(!result.chunk.toLowerCase().includes("carrot"));
  assert.equal(result.score, 1);
});

test("findBestPassage refines a coarse chunk down to the single query-relevant sentence", async () => {
  // One long chunk with three real sentences; only the middle one is about
  // banana. The old behavior returned the whole ~1000-char chunk (and the
  // in-page matcher then highlighted whichever sentence was longest); now the
  // returned passage must be just the banana sentence.
  const filler = "Carrots grow underground and are orange root vegetables. ";
  const bananaSentence =
    "A banana is a long curved yellow tropical fruit that grows in bunches.";
  const content = filler.repeat(6) + bananaSentence + " " + filler.repeat(6);

  const result = await findBestPassage(
    { content, query: "tell me about banana" },
    { embedTextsFn: fakeEmbed },
  );

  assert.ok(result);
  assert.strictEqual(result.chunk, bananaSentence);
  // The score stays the coarse chunk-level score, not a per-sentence one.
  assert.strictEqual(result.score, 1);
});

test("findBestPassage returns null for empty content or query", async () => {
  assert.equal(
    await findBestPassage(
      { content: "", query: "anything" },
      { embedTextsFn: fakeEmbed },
    ),
    null,
  );
  assert.equal(
    await findBestPassage(
      { content: "some real content here", query: "" },
      { embedTextsFn: fakeEmbed },
    ),
    null,
  );
});

test("findBestPassage returns null when embedding fails", async () => {
  const embedTextsFn = () => {
    throw new Error("model unavailable");
  };
  const result = await findBestPassage(
    { content: "some page content", query: "a question" },
    { embedTextsFn },
  );
  assert.equal(result, null);
});

test("findBestPassage shares the cached chunk index with retrieveRelevantContent", async () => {
  // fakeEmbed only recognizes "banana"/"carrot", other words score [0, 0];
  // that's fine here, this test only cares about the *index-build* call
  // count (shared cache), not the actual similarity ranking. A content
  // string not reused by any other test in this file, to make sure this
  // exercises a fresh cache entry rather than reusing one another test
  // already built (the cache is a module-level Map, shared for the whole
  // process this test file runs in).
  const banana = "banana ".repeat(200);
  const filler = "a distinct filler phrase not used elsewhere ".repeat(150);
  const content = `${filler}${banana}${filler}`;

  let indexBuildCalls = 0;
  const embedTextsFn = (texts) => {
    if (texts.length > 1) indexBuildCalls++;
    return fakeEmbed(texts);
  };

  await retrieveRelevantContent(
    { content, question: "banana?", maxContextChars: 500, topK: 1 },
    { embedTextsFn },
  );
  const passage = await findBestPassage(
    { content, query: "banana?" },
    { embedTextsFn },
  );

  assert.equal(indexBuildCalls, 1);
  assert.ok(passage.chunk.toLowerCase().includes("banana"));
});
