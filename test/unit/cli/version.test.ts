import { test, expect, describe } from "bun:test";
import { compareSemver } from "../../../src/version.ts";

describe("compareSemver", () => {
  test("equal versions return 0", () => {
    expect(compareSemver("0.3.0", "0.3.0")).toBe(0);
  });

  test("v-prefixed versions compare correctly", () => {
    expect(compareSemver("v0.3.0", "v0.3.0")).toBe(0);
  });

  test("newer patch returns positive", () => {
    expect(compareSemver("0.3.1", "0.3.0")).toBeGreaterThan(0);
  });

  test("newer minor returns positive", () => {
    expect(compareSemver("0.4.0", "0.3.0")).toBeGreaterThan(0);
  });

  test("newer major returns positive", () => {
    expect(compareSemver("1.0.0", "0.3.0")).toBeGreaterThan(0);
  });

  test("older version returns negative", () => {
    expect(compareSemver("0.2.0", "0.3.0")).toBeLessThan(0);
  });

  test("mixed v-prefix works", () => {
    expect(compareSemver("v0.4.0", "0.3.0")).toBeGreaterThan(0);
  });
});
