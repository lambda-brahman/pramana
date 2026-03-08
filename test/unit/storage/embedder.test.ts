import { test, expect, describe } from "bun:test";
import { cosineSimilarity, loadEmbedder } from "../../../src/storage/embedder.ts";

describe("cosineSimilarity", () => {
  test("identical normalized vectors have similarity 1", () => {
    const v = new Float32Array([0.5773, 0.5773, 0.5773]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 2);
  });

  test("orthogonal vectors have similarity 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  test("opposite vectors have similarity -1", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });
});

describe("loadEmbedder", () => {
  test("returns error for invalid model", async () => {
    const result = await loadEmbedder("nonexistent/model-that-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("embedder");
    expect(result.error.message).toContain("nonexistent/model-that-does-not-exist");
  });

  test("loads gte-small and produces 384-dim embeddings", async () => {
    const result = await loadEmbedder("Xenova/gte-small");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loadTimeMs).toBeGreaterThan(0);
    expect(result.value.embedder.modelId).toBe("Xenova/gte-small");

    const embedding = await result.value.embedder.embed("test query", true);
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(384);

    // Normalized vector should have magnitude ~1
    let magnitude = 0;
    for (let i = 0; i < embedding.length; i++) {
      magnitude += embedding[i]! * embedding[i]!;
    }
    expect(Math.sqrt(magnitude)).toBeCloseTo(1.0, 2);
  }, 60000);
});
