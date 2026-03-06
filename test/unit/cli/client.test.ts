import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TenantManager } from "../../../src/engine/tenant.ts";
import { createServer } from "../../../src/api/server.ts";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");
const FIXTURES_ALT_DIR = path.join(import.meta.dir, "../../fixtures-alt");

describe("CLI client mode", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;
  let tm: TenantManager;
  const cliPath = path.join(import.meta.dir, "../../../src/cli/index.ts");

  beforeAll(async () => {
    tm = new TenantManager();
    await tm.mount({ name: "commerce", sourceDir: FIXTURES_DIR });
    await tm.mount({ name: "notes", sourceDir: FIXTURES_ALT_DIR });
    server = createServer({ port: 0, tenantManager: tm });
    port = server.port!;
  });

  afterAll(() => {
    server.stop();
    tm.close();
  });

  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PRAMANA_PORT: String(port) },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  test("get connects to running daemon", async () => {
    const { stdout, exitCode } = await runCli(["get", "order", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.slug).toBe("order");
    expect(data.title).toBe("Order");
  });

  test("get with section focus via daemon", async () => {
    const { stdout, exitCode } = await runCli(["get", "order#attributes", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.focusedSection).toBeDefined();
    expect(data.focusedSection.heading).toBe("Attributes");
  });

  test("get returns error for missing slug", async () => {
    const { stderr, exitCode } = await runCli(["get", "nonexistent", "--tenant", "commerce"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Not found");
  });

  test("get without --tenant returns error", async () => {
    const { stderr, exitCode } = await runCli(["get", "order"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Specify tenant");
  });

  test("search connects to running daemon", async () => {
    const { stdout, exitCode } = await runCli(["search", "purchase", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    expect(data.some((r) => r.slug === "order")).toBe(true);
  });

  test("traverse connects to running daemon", async () => {
    const { stdout, exitCode } = await runCli(["traverse", "order", "--type", "depends-on", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    expect(data.some((a) => a.slug === "customer")).toBe(true);
  });

  test("list connects to running daemon", async () => {
    const { stdout, exitCode } = await runCli(["list", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<unknown>;
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  test("list with tags filter via daemon", async () => {
    const { stdout, exitCode } = await runCli(["list", "--tags", "entity,commerce", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ tags: string[] }>;
    for (const a of data) {
      expect(a.tags).toContain("entity");
      expect(a.tags).toContain("commerce");
    }
  });

  test("--standalone skips daemon even when running", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "list", "--source", FIXTURES_DIR, "--standalone",
    ]);
    expect(exitCode).toBe(0);
    // Standalone mode prints ingestion summary to stderr
    expect(stderr).toContain("Ingested");
    const data = JSON.parse(stdout) as Array<unknown>;
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  test("missing slug exits with error", async () => {
    const { stderr, exitCode } = await runCli(["get"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing slug");
  });

  test("missing query exits with error", async () => {
    const { stderr, exitCode } = await runCli(["search"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing query");
  });

  // Multi-tenant --tenant flag tests
  test("--tenant routes get to specific tenant", async () => {
    const { stdout, exitCode } = await runCli(["get", "note", "--tenant", "notes"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.slug).toBe("note");
  });

  test("--tenant routes list to specific tenant", async () => {
    const { stdout, exitCode } = await runCli(["list", "--tenant", "notes"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    const slugs = data.map((a) => a.slug);
    expect(slugs).toContain("note");
    expect(slugs).not.toContain("order");
  });

  test("--tenant routes search to specific tenant", async () => {
    const { stdout, exitCode } = await runCli(["search", "category", "--tenant", "notes"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    expect(data.some((r) => r.slug === "category")).toBe(true);
  });

  test("--tenant routes traverse to specific tenant", async () => {
    const { stdout, exitCode } = await runCli(["traverse", "order", "--type", "depends-on", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    expect(data.some((a) => a.slug === "customer")).toBe(true);
  });

  test("--tenant get returns 404 for wrong tenant", async () => {
    const { stderr, exitCode } = await runCli(["get", "order", "--tenant", "notes"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Not found");
  });

  test("reload via daemon with --tenant", async () => {
    const { stdout, exitCode } = await runCli(["reload", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.status).toBe("ok");
  });
});
