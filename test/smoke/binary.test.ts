import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import path from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PRAMANA_BIN = process.env.PRAMANA_BIN ?? path.join(import.meta.dir, "../../pramana");
const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function run(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([PRAMANA_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function waitForDaemon(
  port: number,
  endpoint: string,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}${endpoint}`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`Daemon did not become ready on port ${port} within ${timeoutMs}ms`);
}

async function httpGet(
  port: number,
  urlPath: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://localhost:${port}${urlPath}`);
  const body = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text();
  return { status: res.status, body };
}

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 10000);
}

// ==========================================================================
// Block 1: Basic binary execution (no server)
// ==========================================================================
describe("Binary basics", () => {
  test("version exits 0 and prints version", async () => {
    const { stdout, exitCode } = await run(["version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  test("--help exits 0", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });
});

// ==========================================================================
// Block 2: Standalone commands (no daemon)
// ==========================================================================
describe("Standalone commands", () => {
  test("list returns artifacts", async () => {
    const { stdout, exitCode } = await run([
      "list",
      "--source", FIXTURES_DIR,
      "--standalone",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("order");
    expect(stdout).toContain("customer");
  });

  test("get retrieves an artifact", async () => {
    const { stdout, exitCode } = await run([
      "get", "order",
      "--source", FIXTURES_DIR,
      "--standalone",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("order");
  });

  test("search returns results", async () => {
    const { stdout, exitCode } = await run([
      "search", "purchase",
      "--source", FIXTURES_DIR,
      "--standalone",
    ]);
    expect(exitCode).toBe(0);
    // search should find something in the commerce fixtures
    expect(stdout.length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// Block 3: Daemon mode (serve + query via HTTP)
// ==========================================================================
describe("Daemon mode", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  const port = randomPort();
  const tenant = "fixtures";

  beforeAll(async () => {
    daemonProc = Bun.spawn(
      [PRAMANA_BIN, "serve", "--source", `${FIXTURES_DIR}:${tenant}`, "--port", String(port)],
      { stdout: "pipe", stderr: "pipe" },
    );
    await waitForDaemon(port, "/v1/version");
  });

  afterAll(() => {
    daemonProc?.kill();
  });

  test("version endpoint responds", async () => {
    const { status, body } = await httpGet(port, "/v1/version");
    expect(status).toBe(200);
    expect(body.version).toMatch(/\d+\.\d+\.\d+/);
  });

  test("list via HTTP returns artifacts", async () => {
    const { status, body } = await httpGet(port, `/v1/${tenant}/list`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(4);
  });

  test("get via HTTP retrieves artifact", async () => {
    const { status, body } = await httpGet(port, `/v1/${tenant}/get/order`);
    expect(status).toBe(200);
    expect(body.slug).toBe("order");
  });

  test("search via HTTP returns results", async () => {
    const { status, body } = await httpGet(
      port,
      `/v1/${tenant}/search?q=${encodeURIComponent("purchase")}`,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// Block 4: Embedder loading — WASM backend must work (#38)
// ==========================================================================
describe("Embedder loading", () => {
  test("binary loads embedder without native dep errors", async () => {
    // Standalone search triggers the full pipeline including embedder.
    // With the onnxruntime-node → onnxruntime-web build stub (#38),
    // the WASM backend should load cleanly — no dlopen, no missing dylib.
    const proc = Bun.spawn(
      [PRAMANA_BIN, "search", "purchase", "--source", FIXTURES_DIR, "--standalone"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    // Binary must not crash — exit 0 is mandatory
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);

    // WASM backend should load without native dependency errors (#38)
    expect(stderr).not.toContain("dlopen");
    expect(stderr).not.toContain("libonnxruntime");
  }, 120_000); // 2 min timeout for potential model download
});
