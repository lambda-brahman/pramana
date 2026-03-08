import { test, expect, describe } from "bun:test";
import { SqlitePlugin } from "../../src/storage/sqlite/index.ts";
import { Builder } from "../../src/engine/builder.ts";
import { Reader } from "../../src/engine/reader.ts";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("Full pipeline: ingest → query", () => {
  let reader: Reader;
  let storage: SqlitePlugin;

  test("build from fixtures", async () => {
    storage = new SqlitePlugin(":memory:");
    storage.initialize();

    const builder = new Builder(storage);
    const result = await builder.build(FIXTURES_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.succeeded).toBeGreaterThanOrEqual(4);
    expect(result.value.failed).toHaveLength(0);

    reader = new Reader(storage, storage);
  });

  test("get order artifact", () => {
    const result = reader.get("order");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value!.slug).toBe("order");
    expect(result.value!.title).toBe("Order");
    expect(result.value!.summary).toBe("A customer's intent to purchase one or more products");
    expect(result.value!.aliases).toEqual(["purchase-order", "sales-order", "transaction"]);
    expect(result.value!.tags).toContain("entity");
    expect(result.value!.tags).toContain("commerce");
    expect(result.value!.sections.length).toBeGreaterThanOrEqual(2);
  });

  test("get with section focus", () => {
    const result = reader.get("order#attributes");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value!.focusedSection).toBeDefined();
    expect(result.value!.focusedSection!.heading).toBe("Attributes");
  });

  test("search for purchase", async () => {
    const result = await reader.search("purchase");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(1);
    expect(result.value.some((r) => r.slug === "order")).toBe(true);
  });

  test("search by alias finds artifact", async () => {
    // "transaction" only appears in order.md aliases, not in title/content
    const result = await reader.search("transaction");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(1);
    expect(result.value.some((r) => r.slug === "order")).toBe(true);
  });

  test("search results include summary", async () => {
    const result = await reader.search("purchase");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const orderResult = result.value.find((r) => r.slug === "order");
    expect(orderResult).toBeDefined();
    expect(orderResult!.summary).toBe("A customer's intent to purchase one or more products");
  });

  test("traverse order depends-on", () => {
    const result = reader.traverse("order", "depends-on");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((a) => a.slug === "customer")).toBe(true);
    expect(result.value.some((a) => a.slug === "line-item")).toBe(true);
    expect(result.value.some((a) => a.slug === "shipping-info")).toBe(true);
  });

  test("list all", () => {
    const result = reader.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(4);
  });

  test("list with tag filter", () => {
    const result = reader.list({ tags: ["entity", "commerce"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(2);
    for (const a of result.value) {
      expect(a.tags).toContain("entity");
      expect(a.tags).toContain("commerce");
    }
  });

  test("inverse relationships computed", () => {
    const result = reader.get("customer");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value!.inverseRelationships.length).toBeGreaterThanOrEqual(1);
  });
});
