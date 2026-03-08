import { test, expect, describe } from "bun:test";
import { orQuery, raw } from "../../../src/storage/fts5-preprocessor.ts";

describe("fts5-preprocessor", () => {
  describe("raw", () => {
    test("passes query through unchanged", () => {
      expect(raw("hello world")).toBe("hello world");
    });
  });

  describe("orQuery", () => {
    test("joins content words with OR", () => {
      expect(orQuery("search work")).toBe("search OR work");
    });

    test("strips stop words", () => {
      expect(orQuery("how does search work")).toBe("search OR work");
    });

    test("handles all stop words by falling back to original tokens", () => {
      expect(orQuery("is the")).toBe("is OR the");
    });

    test("handles single meaningful word", () => {
      expect(orQuery("the order")).toBe("order");
    });

    test("strips punctuation", () => {
      expect(orQuery("what's the order?")).toBe("s OR order");
    });

    test("lowercases input", () => {
      expect(orQuery("Order Customer")).toBe("order OR customer");
    });

    test("handles hyphenated words", () => {
      expect(orQuery("line-item")).toBe("line-item");
    });

    test("handles extra whitespace", () => {
      expect(orQuery("  search   work  ")).toBe("search OR work");
    });
  });
});
