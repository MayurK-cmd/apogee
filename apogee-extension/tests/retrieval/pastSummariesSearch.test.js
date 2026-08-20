import test from "node:test";
import assert from "node:assert";
import { searchPastSummaries } from "../../lib/retrieval/pastSummariesSearch.js";

test("searchPastSummaries returns all entries when query is empty", async () => {
  const cacheOrder = [
    { s: "k1", p: "p1", t: "First Article" },
    { s: "k2", p: "p2", t: "Second Article" },
  ];
  const storedSummaries = {
    k1: "Text one",
    k2: "Text two",
  };

  const results = await searchPastSummaries({
    query: "",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });

  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].s, "k1");
  assert.strictEqual(results[1].s, "k2");
});

test("searchPastSummaries performs keyword matching on title and body when embeddings unavailable", async () => {
  const cacheOrder = [
    { s: "k1", p: "p1", t: "Quantum Computing Breakdown" },
    { s: "k2", p: "p2", t: "Cooking Recipe for Pancakes" },
  ];
  const storedSummaries = {
    k1: "Discusses qubits and superposition principles.",
    k2: "Ingredients include flour, milk, and eggs.",
  };

  const titleMatch = await searchPastSummaries({
    query: "Quantum",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });
  assert.strictEqual(titleMatch.length, 1);
  assert.strictEqual(titleMatch[0].s, "k1");

  const bodyMatch = await searchPastSummaries({
    query: "qubits",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });
  assert.strictEqual(bodyMatch.length, 1);
  assert.strictEqual(bodyMatch[0].s, "k1");

  const noMatch = await searchPastSummaries({
    query: "Astrophysics",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });
  assert.strictEqual(noMatch.length, 0);
});

test("searchPastSummaries uses vector embeddings to rank semantically relevant summaries", async () => {
  const cacheOrder = [
    { s: "k1", p: "p1", t: "Physics Paper", v: [1, 0, 0] },
    { s: "k2", p: "p2", t: "Recipe Book", v: [0, 1, 0] },
  ];
  const storedSummaries = {
    k1: "Details about quantum particles and energy levels.",
    k2: "Baking bread and cakes at high temperatures.",
  };

  const mockEmbed = async (_texts) => {
    // Return query vector close to physics [0.9, 0.1, 0]
    return [[0.9, 0.1, 0]];
  };

  const results = await searchPastSummaries({
    query: "particle physics",
    cacheOrder,
    storedSummaries,
    embedTextsFn: mockEmbed,
  });

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].s, "k1");
});
