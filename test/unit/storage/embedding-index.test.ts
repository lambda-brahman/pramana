import { test, expect, describe } from "bun:test";
import { EmbeddingIndex } from "../../../src/storage/embedding-index.ts";

function syntheticVector(dims: number, seed: number): Float32Array {
  const vec = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    vec[i] = Math.sin(seed * (i + 1));
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) vec[i] = vec[i]! / norm;
  return vec;
}

describe("EmbeddingIndex", () => {
  test("add and search returns closest match", () => {
    const index = new EmbeddingIndex();
    const v1 = syntheticVector(384, 1);
    const v2 = syntheticVector(384, 2);
    const v3 = syntheticVector(384, 3);

    index.add("a", v1);
    index.add("b", v2);
    index.add("c", v3);

    // Query with v1 itself should return "a" first
    const results = index.search(v1, 3);
    expect(results).toHaveLength(3);
    expect(results[0]!.slug).toBe("a");
    expect(results[0]!.score).toBeCloseTo(1.0, 4);
  });

  test("search respects limit", () => {
    const index = new EmbeddingIndex();
    index.add("a", syntheticVector(384, 1));
    index.add("b", syntheticVector(384, 2));
    index.add("c", syntheticVector(384, 3));

    const results = index.search(syntheticVector(384, 1), 2);
    expect(results).toHaveLength(2);
  });

  test("remove deletes entry", () => {
    const index = new EmbeddingIndex();
    index.add("a", syntheticVector(384, 1));
    index.add("b", syntheticVector(384, 2));

    expect(index.size).toBe(2);
    index.remove("a");
    expect(index.size).toBe(1);

    const results = index.search(syntheticVector(384, 1), 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.slug).toBe("b");
  });

  test("clear removes all entries", () => {
    const index = new EmbeddingIndex();
    index.add("a", syntheticVector(384, 1));
    index.add("b", syntheticVector(384, 2));

    index.clear();
    expect(index.size).toBe(0);

    const results = index.search(syntheticVector(384, 1), 10);
    expect(results).toHaveLength(0);
  });

  test("size tracks entry count", () => {
    const index = new EmbeddingIndex();
    expect(index.size).toBe(0);

    index.add("a", syntheticVector(384, 1));
    expect(index.size).toBe(1);

    index.add("b", syntheticVector(384, 2));
    expect(index.size).toBe(2);
  });

  test("search on empty index returns empty array", () => {
    const index = new EmbeddingIndex();
    const results = index.search(syntheticVector(384, 1), 10);
    expect(results).toHaveLength(0);
  });

  test("add overwrites existing slug", () => {
    const index = new EmbeddingIndex();
    const v1 = syntheticVector(384, 1);
    const v2 = syntheticVector(384, 2);

    index.add("a", v1);
    index.add("a", v2);
    expect(index.size).toBe(1);

    // Should match v2 now
    const results = index.search(v2, 1);
    expect(results[0]!.slug).toBe("a");
    expect(results[0]!.score).toBeCloseTo(1.0, 4);
  });
});
