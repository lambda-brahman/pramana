import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { SqlitePlugin } from "../../src/storage/sqlite/index.ts";
import { Builder } from "../../src/engine/builder.ts";
import { Reader } from "../../src/engine/reader.ts";
import { createServer } from "../../src/api/server.ts";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("API endpoints", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeAll(async () => {
    const storage = new SqlitePlugin(":memory:");
    storage.initialize();

    const builder = new Builder(storage);
    await builder.build(FIXTURES_DIR);

    const reader = new Reader(storage, storage);
    server = createServer({ port: 0, reader });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("GET /v1/get/:slug returns artifact", async () => {
    const res = await fetch(`${baseUrl}/v1/get/order`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.slug).toBe("order");
    expect(data.title).toBe("Order");
    expect(data.tags).toContain("entity");
  });

  test("GET /v1/get/:slug returns 404 for missing", async () => {
    const res = await fetch(`${baseUrl}/v1/get/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("GET /v1/get/:slug/:section returns section focus", async () => {
    const res = await fetch(`${baseUrl}/v1/get/order/attributes`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, any>;
    expect(data.focusedSection).toBeDefined();
    expect(data.focusedSection.heading).toBe("Attributes");
  });

  test("GET /v1/search?q= returns results", async () => {
    const res = await fetch(`${baseUrl}/v1/search?q=purchase`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ slug: string }>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.some((r) => r.slug === "order")).toBe(true);
  });

  test("GET /v1/search without q returns 400", async () => {
    const res = await fetch(`${baseUrl}/v1/search`);
    expect(res.status).toBe(400);
  });

  test("GET /v1/traverse/:from returns related", async () => {
    const res = await fetch(`${baseUrl}/v1/traverse/order?type=needs`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ slug: string }>;
    expect(data.some((a) => a.slug === "customer")).toBe(true);
  });

  test("GET /v1/list returns all", async () => {
    const res = await fetch(`${baseUrl}/v1/list`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<unknown>;
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  test("GET /v1/list?tags= filters by tags", async () => {
    const res = await fetch(`${baseUrl}/v1/list?tags=entity,commerce`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Array<{ tags: string[] }>;
    for (const a of data) {
      expect(a.tags).toContain("entity");
      expect(a.tags).toContain("commerce");
    }
  });

  test("CORS headers present", async () => {
    const res = await fetch(`${baseUrl}/v1/list`);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(`${baseUrl}/v1/unknown`);
    expect(res.status).toBe(404);
  });
});
