import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TenantManager } from "../../src/engine/tenant.ts";
import { createServer } from "../../src/api/server.ts";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");
const FIXTURES_ALT_DIR = path.join(import.meta.dir, "../fixtures-alt");

describe("API endpoints", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let tm: TenantManager;

  beforeAll(async () => {
    tm = new TenantManager();
    await tm.mount({ name: "test", sourceDir: FIXTURES_DIR });

    server = createServer({ port: 0, tenantManager: tm });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
    tm.close();
  });

  test("GET /v1/test/get/:slug returns artifact", async () => {
    const res = await fetch(`${baseUrl}/v1/test/get/order`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.slug).toBe("order");
    expect(data.title).toBe("Order");
    expect(data.tags).toContain("entity");
  });

  test("GET /v1/test/get/:slug returns 404 for missing", async () => {
    const res = await fetch(`${baseUrl}/v1/test/get/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("GET /v1/test/get/:slug/:section returns section focus", async () => {
    const res = await fetch(`${baseUrl}/v1/test/get/order/attributes`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, any>;
    expect(data.focusedSection).toBeDefined();
    expect(data.focusedSection.heading).toBe("Attributes");
  });

  test("GET /v1/test/search?q= returns results", async () => {
    const res = await fetch(`${baseUrl}/v1/test/search?q=purchase`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ slug: string }>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.some((r) => r.slug === "order")).toBe(true);
  });

  test("GET /v1/test/search without q returns 400", async () => {
    const res = await fetch(`${baseUrl}/v1/test/search`);
    expect(res.status).toBe(400);
  });

  test("GET /v1/test/traverse/:from returns related", async () => {
    const res = await fetch(`${baseUrl}/v1/test/traverse/order?type=depends-on`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ slug: string }>;
    expect(data.some((a) => a.slug === "customer")).toBe(true);
  });

  test("GET /v1/test/list returns all", async () => {
    const res = await fetch(`${baseUrl}/v1/test/list`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<unknown>;
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  test("GET /v1/test/list?tags= filters by tags", async () => {
    const res = await fetch(`${baseUrl}/v1/test/list?tags=entity,commerce`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ tags: string[] }>;
    for (const a of data) {
      expect(a.tags).toContain("entity");
      expect(a.tags).toContain("commerce");
    }
  });

  test("CORS headers present", async () => {
    const res = await fetch(`${baseUrl}/v1/test/list`);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("GET /v1/version returns version", async () => {
    const res = await fetch(`${baseUrl}/v1/version`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { version: string };
    expect(data.version).toMatch(/^v?\d+\.\d+\.\d+$/);
  });

  test("GET /v1/list without tenant returns 400", async () => {
    const res = await fetch(`${baseUrl}/v1/list`);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Specify tenant");
  });

  test("GET /v1/get/order without tenant returns 400", async () => {
    const res = await fetch(`${baseUrl}/v1/get/order`);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Specify tenant");
  });
});

describe("Multi-tenant API", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let tm: TenantManager;

  beforeAll(async () => {
    tm = new TenantManager();
    await tm.mount({ name: "commerce", sourceDir: FIXTURES_DIR });
    await tm.mount({ name: "notes", sourceDir: FIXTURES_ALT_DIR });

    server = createServer({ port: 0, tenantManager: tm });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
    tm.close();
  });

  test("GET /v1/tenants returns all tenants", async () => {
    const res = await fetch(`${baseUrl}/v1/tenants`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ name: string; artifactCount: number }>;
    expect(data.length).toBe(2);
    expect(data.find((t) => t.name === "commerce")).toBeDefined();
    expect(data.find((t) => t.name === "notes")).toBeDefined();
  });

  test("GET /v1/:tenant/get/:slug returns tenant-scoped artifact", async () => {
    const res = await fetch(`${baseUrl}/v1/commerce/get/order`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.slug).toBe("order");
  });

  test("GET /v1/:tenant/get/:slug returns 404 for wrong tenant", async () => {
    // "note" exists in notes tenant, not commerce
    const res = await fetch(`${baseUrl}/v1/commerce/get/note`);
    expect(res.status).toBe(404);
  });

  test("GET /v1/:tenant/search works per-tenant", async () => {
    const res = await fetch(`${baseUrl}/v1/notes/search?q=category`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ slug: string }>;
    expect(data.some((r) => r.slug === "category")).toBe(true);
  });

  test("GET /v1/:tenant/list returns tenant artifacts", async () => {
    const res = await fetch(`${baseUrl}/v1/notes/list`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ slug: string }>;
    const slugs = data.map((a) => a.slug);
    expect(slugs).toContain("note");
    expect(slugs).toContain("category");
    expect(slugs).not.toContain("order");
  });

  test("GET /v1/:tenant/traverse works per-tenant", async () => {
    const res = await fetch(`${baseUrl}/v1/commerce/traverse/order?type=depends-on`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ slug: string }>;
    expect(data.some((a) => a.slug === "customer")).toBe(true);
  });

  test("GET /v1/:tenant/get/:slug/:section returns section focus", async () => {
    const res = await fetch(`${baseUrl}/v1/notes/get/note/content`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, any>;
    expect(data.focusedSection).toBeDefined();
    expect(data.focusedSection.heading).toBe("Content");
  });

  test("GET /v1/list without tenant returns 400", async () => {
    const res = await fetch(`${baseUrl}/v1/list`);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Specify tenant");
    expect(data.error).toContain("commerce");
  });

  test("POST /v1/reload without tenant returns 400", async () => {
    const res = await fetch(`${baseUrl}/v1/reload`, { method: "POST" });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Specify tenant");
  });

  test("POST /v1/:tenant/reload rebuilds tenant", async () => {
    const res = await fetch(`${baseUrl}/v1/commerce/reload`, { method: "POST" });
    expect(res.status).toBe(200);

    const data = (await res.json()) as { status: string; report: { succeeded: number } };
    expect(data.status).toBe("ok");
    expect(data.report.succeeded).toBeGreaterThan(0);

    // Verify tenant still works after reload
    const getRes = await fetch(`${baseUrl}/v1/commerce/get/order`);
    expect(getRes.status).toBe(200);
  });

  test("tenant isolation — commerce cannot see notes artifacts", async () => {
    const res = await fetch(`${baseUrl}/v1/commerce/get/note`);
    expect(res.status).toBe(404);
  });

  test("tenant isolation — notes cannot see commerce artifacts", async () => {
    const res = await fetch(`${baseUrl}/v1/notes/get/order`);
    expect(res.status).toBe(404);
  });

  test("CORS includes POST method", async () => {
    const res = await fetch(`${baseUrl}/v1/tenants`);
    const methods = res.headers.get("Access-Control-Allow-Methods");
    expect(methods).toContain("POST");
  });

  test("GET /v1/version works in multi-tenant mode", async () => {
    const res = await fetch(`${baseUrl}/v1/version`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { version: string };
    expect(data.version).toBeTruthy();
  });

  test("OPTIONS returns 204 preflight", async () => {
    const res = await fetch(`${baseUrl}/v1/tenants`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });
});
