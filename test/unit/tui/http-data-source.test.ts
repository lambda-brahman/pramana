import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { createServer } from "../../../src/api/server.ts";
import { TenantManager } from "../../../src/engine/tenant.ts";
import { createHttpDataSource, type DataSource } from "../../../src/tui/data-source.ts";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");

describe("createHttpDataSource", () => {
  let server: ReturnType<typeof createServer>;
  let tm: TenantManager;
  let ds: DataSource;

  beforeAll(async () => {
    tm = new TenantManager();
    await tm.mount({ name: "test", sourceDir: FIXTURES_DIR });
    server = createServer({ port: 0, tenantManager: tm });
    ds = createHttpDataSource(String(server.port));
  });

  afterAll(() => {
    server.stop();
    tm.close();
  });

  test("mode is daemon", () => {
    expect(ds.mode).toBe("daemon");
  });

  test("list returns all artifacts", async () => {
    const result = await ds.list("test");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(4);
    const slugs = result.value.map((a) => a.slug).sort();
    expect(slugs).toEqual(["customer", "line-item", "order", "shipping-info"]);
  });

  test("list with tag filter", async () => {
    const result = await ds.list("test", { tags: ["entity"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const a of result.value) {
        expect(a.tags).toContain("entity");
      }
    }
  });

  test("get returns artifact by slug", async () => {
    const result = await ds.get("test", "order");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value!.slug).toBe("order");
    expect(result.value!.title).toBe("Order");
    expect(result.value!.tags).toContain("entity");
  });

  test("get with section returns focused section", async () => {
    const result = await ds.get("test", "order#attributes");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value!.focusedSection).toBeDefined();
    expect(result.value!.focusedSection!.heading).toBe("Attributes");
  });

  test("get returns null for missing slug", async () => {
    const result = await ds.get("test", "nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  test("search returns results", async () => {
    const result = await ds.search("test", "purchase");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(1);
    expect(result.value.some((r) => r.slug === "order")).toBe(true);
  });

  test("traverse returns related artifacts", async () => {
    const result = await ds.traverse("test", "order", "depends-on", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.some((a) => a.slug === "customer")).toBe(true);
  });

  test("traverse with depth", async () => {
    const depth1 = await ds.traverse("test", "order", undefined, 1);
    const depth2 = await ds.traverse("test", "order", undefined, 2);
    expect(depth1.ok).toBe(true);
    expect(depth2.ok).toBe(true);
    if (depth1.ok && depth2.ok) {
      expect(depth2.value.length).toBeGreaterThanOrEqual(depth1.value.length);
    }
  });

  test("listTenants returns tenant info", async () => {
    const result = await ds.listTenants();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.name).toBe("test");
    expect(result.value[0]!.artifactCount).toBe(4);
  });

  test("reload returns build report", async () => {
    const result = await ds.reload("test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.succeeded).toBeGreaterThan(0);
    }
  });

  test("get returns error for non-existent tenant", async () => {
    const result = await ds.list("nonexistent");
    expect(result.ok).toBe(false);
  });
});
