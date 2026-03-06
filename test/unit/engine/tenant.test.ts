import { test, expect, describe, afterEach } from "bun:test";
import { TenantManager } from "../../../src/engine/tenant.ts";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");
const FIXTURES_ALT_DIR = path.join(import.meta.dir, "../../fixtures-alt");

describe("TenantManager", () => {
  let tm: TenantManager;

  afterEach(() => {
    tm?.close();
  });

  test("mount creates tenant with storage and reader", async () => {
    tm = new TenantManager();
    const result = await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.succeeded).toBeGreaterThan(0);
      expect(result.value.total).toBeGreaterThan(0);
    }

    const reader = tm.getReader("kb");
    expect(reader.ok).toBe(true);
  });

  test("mount rejects duplicate names", async () => {
    tm = new TenantManager();
    await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });
    const result = await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("already mounted");
    }
  });

  test("mount rejects reserved names", async () => {
    tm = new TenantManager();
    for (const reserved of ["get", "search", "traverse", "list", "tenants", "reload"]) {
      const result = await tm.mount({ name: reserved, sourceDir: FIXTURES_DIR });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Reserved");
      }
    }
  });

  test("mount rejects invalid names", async () => {
    tm = new TenantManager();
    const invalid = ["123", "UPPER", "has space", "has_underscore", "-starts-dash", ""];
    for (const name of invalid) {
      const result = await tm.mount({ name, sourceDir: FIXTURES_DIR });
      expect(result.ok).toBe(false);
    }
  });

  test("getReader returns reader for mounted tenant", async () => {
    tm = new TenantManager();
    await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });
    const reader = tm.getReader("kb");
    expect(reader.ok).toBe(true);
    if (reader.ok) {
      const result = reader.value.list();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  test("getReader returns error for unknown tenant", () => {
    tm = new TenantManager();
    const reader = tm.getReader("unknown");
    expect(reader.ok).toBe(false);
  });

  test("getDefaultReader returns first mounted tenant", async () => {
    tm = new TenantManager();
    await tm.mount({ name: "first", sourceDir: FIXTURES_DIR });
    await tm.mount({ name: "second", sourceDir: FIXTURES_ALT_DIR });

    const reader = tm.getDefaultReader();
    expect(reader.ok).toBe(true);
    if (reader.ok) {
      const list = reader.value.list();
      expect(list.ok).toBe(true);
      if (list.ok) {
        // first tenant has fixtures (order, customer, etc.)
        expect(list.value.some((a) => a.slug === "order")).toBe(true);
      }
    }
  });

  test("getDefaultReader returns error when no tenants", () => {
    tm = new TenantManager();
    const reader = tm.getDefaultReader();
    expect(reader.ok).toBe(false);
    if (!reader.ok) {
      expect(reader.error.message).toContain("No tenants");
    }
  });

  test("defaultTenantName returns first tenant name", async () => {
    tm = new TenantManager();
    expect(tm.defaultTenantName()).toBeNull();

    await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });
    expect(tm.defaultTenantName()).toBe("kb");
  });

  test("listTenants returns all mounted tenants", async () => {
    tm = new TenantManager();
    await tm.mount({ name: "main", sourceDir: FIXTURES_DIR });
    await tm.mount({ name: "alt", sourceDir: FIXTURES_ALT_DIR });

    const tenants = tm.listTenants();
    expect(tenants.length).toBe(2);
    expect(tenants.find((t) => t.name === "main")).toBeDefined();
    expect(tenants.find((t) => t.name === "alt")).toBeDefined();

    const main = tenants.find((t) => t.name === "main")!;
    expect(main.artifactCount).toBeGreaterThanOrEqual(4);

    const alt = tenants.find((t) => t.name === "alt")!;
    expect(alt.artifactCount).toBe(2);
  });

  test("hasTenant returns correct boolean", async () => {
    tm = new TenantManager();
    expect(tm.hasTenant("kb")).toBe(false);

    await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });
    expect(tm.hasTenant("kb")).toBe(true);
    expect(tm.hasTenant("other")).toBe(false);
  });

  test("reload rebuilds tenant", async () => {
    tm = new TenantManager();
    await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });

    const result = await tm.reload("kb");
    expect(result.ok).toBe(true);

    // Reader still works after reload
    const reader = tm.getReader("kb");
    expect(reader.ok).toBe(true);
    if (reader.ok) {
      const list = reader.value.list();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.value.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  test("reload returns error for unknown tenant", async () => {
    tm = new TenantManager();
    const result = await tm.reload("unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("not found");
    }
  });

  test("multiple tenants are isolated", async () => {
    tm = new TenantManager();
    await tm.mount({ name: "commerce", sourceDir: FIXTURES_DIR });
    await tm.mount({ name: "notes", sourceDir: FIXTURES_ALT_DIR });

    const commerceReader = tm.getReader("commerce");
    const notesReader = tm.getReader("notes");

    expect(commerceReader.ok).toBe(true);
    expect(notesReader.ok).toBe(true);

    if (commerceReader.ok && notesReader.ok) {
      const commerceList = commerceReader.value.list();
      const notesList = notesReader.value.list();

      expect(commerceList.ok).toBe(true);
      expect(notesList.ok).toBe(true);

      if (commerceList.ok && notesList.ok) {
        const commerceSlugs = commerceList.value.map((a) => a.slug);
        const notesSlugs = notesList.value.map((a) => a.slug);

        // Commerce has order, customer, etc. but not note, category
        expect(commerceSlugs).toContain("order");
        expect(commerceSlugs).not.toContain("note");

        // Notes has note, category but not order, customer
        expect(notesSlugs).toContain("note");
        expect(notesSlugs).not.toContain("order");
      }
    }
  });

  test("close cleans up all tenants", async () => {
    tm = new TenantManager();
    await tm.mount({ name: "kb", sourceDir: FIXTURES_DIR });
    expect(tm.hasTenant("kb")).toBe(true);

    tm.close();
    expect(tm.hasTenant("kb")).toBe(false);
    expect(tm.defaultTenantName()).toBeNull();
  });
});
