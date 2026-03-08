import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TenantManager } from "../../../src/engine/tenant.ts";
import { createReaderDataSource, type DataSource } from "../../../src/tui/data-source.ts";

describe("createReaderDataSource", () => {
  let tm: TenantManager;
  let ds: DataSource;

  beforeEach(async () => {
    tm = new TenantManager();
    const result = await tm.mount({ name: "test", sourceDir: "test/fixtures" });
    expect(result.ok).toBe(true);
    ds = createReaderDataSource(tm);
  });

  afterEach(() => {
    tm.close();
  });

  test("mode is standalone", () => {
    expect(ds.mode).toBe("standalone");
  });

  test("list returns all artifacts", async () => {
    const result = await ds.list("test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(4);
      const slugs = result.value.map((a) => a.slug).sort();
      expect(slugs).toEqual(["customer", "line-item", "order", "shipping-info"]);
    }
  });

  test("list with tag filter", async () => {
    const result = await ds.list("test", { tags: ["domain"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const a of result.value) {
        expect(a.tags).toContain("domain");
      }
    }
  });

  test("get returns artifact by slug", async () => {
    const result = await ds.get("test", "order");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBeNull();
      expect(result.value!.slug).toBe("order");
      expect(result.value!.title).toBeDefined();
    }
  });

  test("get returns null for missing slug", async () => {
    const result = await ds.get("test", "nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  test("search returns results", async () => {
    const result = await ds.search("test", "order");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]!.slug).toBeDefined();
    }
  });

  test("traverse returns related artifacts", async () => {
    const result = await ds.traverse("test", "order", undefined, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
    }
  });

  test("listTenants returns tenant info", async () => {
    const result = await ds.listTenants();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.name).toBe("test");
      expect(result.value[0]!.artifactCount).toBe(4);
    }
  });

  test("returns error for unknown tenant", async () => {
    const result = await ds.list("unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("data-source");
    }
  });
});
