import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");
const FIXTURES_ALT_DIR = path.join(import.meta.dir, "../fixtures-alt");
const CLI_PATH = path.join(import.meta.dir, "../../src/cli/index.ts");
const FIXTURES_TENANT = path.basename(FIXTURES_DIR);

describe("CLI client E2E — daemon mode vs standalone", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  let port: number;

  beforeAll(async () => {
    // Find a free port by starting on port 0 isn't possible via CLI,
    // so pick a random high port
    port = 30000 + Math.floor(Math.random() * 10000);

    daemonProc = Bun.spawn(
      ["bun", "run", CLI_PATH, "serve", "--source", FIXTURES_DIR, "--port", String(port)],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Wait for server to be ready
    const maxWait = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const res = await fetch(`http://localhost:${port}/v1/version`);
        if (res.ok) break;
      } catch {
        // not ready yet
      }
      await Bun.sleep(100);
    }
  });

  afterAll(() => {
    daemonProc.kill();
  });

  async function runClient(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PRAMANA_PORT: String(port) },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  async function runStandalone(args: string[]): Promise<{ stdout: string; exitCode: number }> {
    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, ...args, "--source", FIXTURES_DIR, "--standalone"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { stdout, exitCode };
  }

  test("get output matches between client and standalone", async () => {
    const client = await runClient(["get", "order", "--tenant", FIXTURES_TENANT]);
    const standalone = await runStandalone(["get", "order"]);

    expect(client.exitCode).toBe(0);
    expect(standalone.exitCode).toBe(0);

    const clientData = JSON.parse(client.stdout);
    const standaloneData = JSON.parse(standalone.stdout);

    expect(clientData.slug).toBe(standaloneData.slug);
    expect(clientData.title).toBe(standaloneData.title);
    expect(clientData.tags).toEqual(standaloneData.tags);
  });

  test("list output matches between client and standalone", async () => {
    const client = await runClient(["list", "--tenant", FIXTURES_TENANT]);
    const standalone = await runStandalone(["list"]);

    expect(client.exitCode).toBe(0);
    expect(standalone.exitCode).toBe(0);

    const clientData = JSON.parse(client.stdout) as Array<{ slug: string }>;
    const standaloneData = JSON.parse(standalone.stdout) as Array<{ slug: string }>;

    const clientSlugs = clientData.map((a) => a.slug).sort();
    const standaloneSlugs = standaloneData.map((a) => a.slug).sort();
    expect(clientSlugs).toEqual(standaloneSlugs);
  });

  test("search output matches between client and standalone", async () => {
    const client = await runClient(["search", "purchase", "--tenant", FIXTURES_TENANT]);
    const standalone = await runStandalone(["search", "purchase"]);

    expect(client.exitCode).toBe(0);
    expect(standalone.exitCode).toBe(0);

    const clientData = JSON.parse(client.stdout) as Array<{ slug: string }>;
    const standaloneData = JSON.parse(standalone.stdout) as Array<{ slug: string }>;

    const clientSlugs = clientData.map((a) => a.slug).sort();
    const standaloneSlugs = standaloneData.map((a) => a.slug).sort();
    expect(clientSlugs).toEqual(standaloneSlugs);
  });

  test("client mode does not print ingestion summary", async () => {
    const { stderr, exitCode } = await runClient(["list", "--tenant", FIXTURES_TENANT]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Ingested");
  });

  test("fallback to standalone when daemon is not reachable", async () => {
    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "list", "--source", FIXTURES_DIR, "--port", "59999"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Ingested");
    const data = JSON.parse(stdout) as Array<unknown>;
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  test("no --tenant returns error from server", async () => {
    const { stderr, exitCode } = await runClient(["list"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Specify tenant");
  });
});

describe("CLI client E2E — multi-tenant daemon", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  let port: number;

  beforeAll(async () => {
    port = 30000 + Math.floor(Math.random() * 10000);

    daemonProc = Bun.spawn(
      [
        "bun", "run", CLI_PATH, "serve",
        "--source", `${FIXTURES_DIR}:commerce`,
        "--source", `${FIXTURES_ALT_DIR}:notes`,
        "--port", String(port),
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Wait for server to be ready
    const maxWait = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const res = await fetch(`http://localhost:${port}/v1/tenants`);
        if (res.ok) break;
      } catch {
        // not ready yet
      }
      await Bun.sleep(100);
    }
  });

  afterAll(() => {
    daemonProc.kill();
  });

  async function runClient(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PRAMANA_PORT: String(port) },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  test("--tenant commerce returns commerce artifacts", async () => {
    const { stdout, exitCode } = await runClient(["get", "order", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.slug).toBe("order");
  });

  test("--tenant notes returns notes artifacts", async () => {
    const { stdout, exitCode } = await runClient(["get", "note", "--tenant", "notes"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.slug).toBe("note");
  });

  test("--tenant isolation: commerce does not have note", async () => {
    const { stderr, exitCode } = await runClient(["get", "note", "--tenant", "commerce"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Not found");
  });

  test("no --tenant returns error", async () => {
    const { stderr, exitCode } = await runClient(["get", "order"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Specify tenant");
  });

  test("list --tenant notes shows only notes", async () => {
    const { stdout, exitCode } = await runClient(["list", "--tenant", "notes"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    const slugs = data.map((a) => a.slug);
    expect(slugs).toContain("note");
    expect(slugs).not.toContain("order");
  });

  test("reload --tenant commerce succeeds", async () => {
    const { stdout, exitCode } = await runClient(["reload", "--tenant", "commerce"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.status).toBe("ok");
  });
});
