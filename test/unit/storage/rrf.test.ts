import { test, expect, describe } from "bun:test";
import { rrf } from "../../../src/storage/rrf.ts";

describe("rrf", () => {
  test("fuses two ranked lists", () => {
    const listA = [
      { slug: "a", score: 1.0 },
      { slug: "b", score: 0.8 },
      { slug: "c", score: 0.6 },
    ];
    const listB = [
      { slug: "b", score: 1.0 },
      { slug: "c", score: 0.8 },
      { slug: "a", score: 0.6 },
    ];

    const result = rrf([listA, listB], 10, 3);
    expect(result).toHaveLength(3);
    // All items appear in both lists, scores depend on positions
    // a: 1/(10+1) + 1/(10+3) ≈ 0.0909 + 0.0769 = 0.1678
    // b: 1/(10+2) + 1/(10+1) ≈ 0.0833 + 0.0909 = 0.1742
    // c: 1/(10+3) + 1/(10+2) ≈ 0.0769 + 0.0833 = 0.1603
    // b should be first
    expect(result[0]!.slug).toBe("b");
  });

  test("penalizes items missing from a list", () => {
    const listA = [{ slug: "a", score: 1.0 }];
    const listB = [{ slug: "b", score: 1.0 }];

    const result = rrf([listA, listB], 10, 2);
    expect(result).toHaveLength(2);
    // a: 1/(10+1) + 1/(10+3) = 0.0909 + 0.0769 (penalty rank=3)
    // b: 1/(10+3) + 1/(10+1) = 0.0769 + 0.0909 (penalty rank=3)
    // Both should have same score
    expect(result[0]!.score).toBeCloseTo(result[1]!.score, 10);
  });

  test("handles empty lists", () => {
    const result = rrf([], 10, 5);
    expect(result).toHaveLength(0);
  });

  test("handles single list", () => {
    const list = [
      { slug: "a", score: 1.0 },
      { slug: "b", score: 0.5 },
    ];
    const result = rrf([list], 10, 2);
    expect(result).toHaveLength(2);
    // a: 1/(10+1) = 0.0909
    // b: 1/(10+2) = 0.0833
    expect(result[0]!.slug).toBe("a");
    expect(result[1]!.slug).toBe("b");
  });

  test("handles all empty input lists", () => {
    const result = rrf([[], []], 10, 5);
    expect(result).toHaveLength(0);
  });

  test("items in all lists score higher than items in one", () => {
    const listA = [
      { slug: "common", score: 1.0 },
      { slug: "only-a", score: 0.5 },
    ];
    const listB = [
      { slug: "common", score: 0.8 },
      { slug: "only-b", score: 0.5 },
    ];

    const result = rrf([listA, listB], 10, 3);
    // "common" appears in both lists at rank 0 → highest RRF score
    expect(result[0]!.slug).toBe("common");
  });
});
