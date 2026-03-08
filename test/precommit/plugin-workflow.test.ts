import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.join(import.meta.dir, "../..");
const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");
const FIXTURES_ALT_DIR = path.join(import.meta.dir, "../fixtures-alt");
const CLI_PATH = path.join(import.meta.dir, "../../src/cli/index.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
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
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}${endpoint}`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`Daemon did not become ready on port ${port} within ${timeoutMs}ms`);
}

async function httpGet(
  port: number,
  urlPath: string,
): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`http://localhost:${port}${urlPath}`);
  const body = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text();
  return { status: res.status, body, headers: res.headers };
}

async function httpPost(
  port: number,
  urlPath: string,
): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`http://localhost:${port}${urlPath}`, { method: "POST" });
  const body = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text();
  return { status: res.status, body, headers: res.headers };
}

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 10000);
}

// ==========================================================================
// Block 1: Plugin structure validation (no daemon)
// ==========================================================================
describe("Plugin structure validation", () => {
  const marketplacePath = path.join(PROJECT_ROOT, ".claude-plugin/marketplace.json");
  const pluginJsonPath = path.join(PROJECT_ROOT, "plugin/.claude-plugin/plugin.json");
  let marketplace: any;
  let pluginJson: any;

  beforeAll(() => {
    marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
    pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
  });

  test("marketplace.json has valid structure", () => {
    expect(marketplace.name).toBe("lambda-brahman");
    expect(marketplace.owner.name).toBeTruthy();
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins.length).toBeGreaterThanOrEqual(1);
    expect(marketplace.metadata.version).toBeTruthy();
  });

  test("plugin.json has valid structure", () => {
    expect(pluginJson.name).toBe("pramana");
    expect(pluginJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pluginJson.description).toBeTruthy();
    expect(pluginJson.author.name).toBeTruthy();
  });

  test("marketplace source resolves to plugin dir", () => {
    const source = marketplace.plugins[0].source;
    expect(source).toBe("./plugin");
    const resolved = path.resolve(PROJECT_ROOT, source);
    expect(fs.existsSync(resolved)).toBe(true);
    expect(fs.existsSync(path.join(resolved, ".claude-plugin/plugin.json"))).toBe(true);
  });

  test("plugin version matches marketplace version", () => {
    expect(pluginJson.version).toBe(marketplace.plugins[0].version);
  });

  test("setup skill exists with valid frontmatter", () => {
    const skillPath = path.join(PROJECT_ROOT, "plugin/skills/setup/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("name: setup");
    expect(content).toContain("user_invocable: true");
    expect(content).toContain("disable-model-invocation: true");
  });

  test("query skill exists with valid frontmatter and is auto-invocable", () => {
    const skillPath = path.join(PROJECT_ROOT, "plugin/skills/query/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("name: query");
    expect(content).toContain("user_invocable: true");
    expect(content).not.toContain("disable-model-invocation");
  });

  test("write skill does not exist (replaced by author agents)", () => {
    const skillPath = path.join(PROJECT_ROOT, "plugin/skills/write/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(false);
  });

  test("create-author skill exists with valid frontmatter and produces agent format", () => {
    const skillPath = path.join(PROJECT_ROOT, "plugin/skills/create-author/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("name: create-author");
    expect(content).toContain("user_invocable: true");
    expect(content).toContain("disable-model-invocation: true");
    expect(content).toContain(".claude/agents/");
    expect(content).toContain("tools: Bash, Read, Write, Glob, Grep");
  });

  test("upgrade skill exists with valid frontmatter", () => {
    const skillPath = path.join(PROJECT_ROOT, "plugin/skills/upgrade/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("name: upgrade");
    expect(content).toContain("user_invocable: true");
    expect(content).toContain("disable-model-invocation: true");
  });

  test("setup skill references version check", () => {
    const skillPath = path.join(PROJECT_ROOT, "plugin/skills/setup/SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("pramana version");
    expect(content).toContain("pramana upgrade");
  });
});

// ==========================================================================
// Block 2: Single-tenant daemon
// ==========================================================================
describe("Single-tenant daemon", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  let port: number;
  const tenant = path.basename(FIXTURES_DIR);

  function runClient(args: string[]) {
    return runCli(args, { PRAMANA_PORT: String(port) });
  }

  beforeAll(async () => {
    port = randomPort();
    daemonProc = Bun.spawn(
      ["bun", "run", CLI_PATH, "serve", "--source", FIXTURES_DIR, "--port", String(port)],
      { stdout: "pipe", stderr: "pipe" },
    );
    await waitForDaemon(port, "/v1/version");
  });

  afterAll(() => {
    daemonProc.kill();
  });

  test("pramana version prints version", async () => {
    const { stdout, exitCode } = await runCli(["version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^pramana v?\d+\.\d+\.\d+$/);
  });

  test("pramana --version prints version", async () => {
    const { stdout, exitCode } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^pramana v?\d+\.\d+\.\d+$/);
  });

  test("pramana --help exits 0", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pramana");
    expect(stdout).toContain("Usage:");
  });

  test("no args shows usage and exits 0", async () => {
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  test("standalone ingestion prints report to stderr", async () => {
    const { stderr } = await runCli([
      "list", "--source", FIXTURES_DIR, "--standalone",
    ]);
    expect(stderr).toContain("Ingested");
    expect(stderr).toContain("4/4");
  });

  test("list returns all 4 fixture artifacts", async () => {
    const { stdout, exitCode } = await runClient(["list", "--tenant", tenant]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    const slugs = data.map((a) => a.slug).sort();
    expect(slugs).toEqual(["customer", "line-item", "order", "shipping-info"]);
  });

  test("get retrieves artifact by slug", async () => {
    const { stdout, exitCode } = await runClient(["get", "order", "--tenant", tenant]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.slug).toBe("order");
    expect(data.title).toBe("Order");
  });

  test("search finds relevant artifacts", async () => {
    const { stdout, exitCode } = await runClient(["search", "purchase", "--tenant", tenant]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    expect(data.some((a) => a.slug === "order")).toBe(true);
  });

  test("traverse follows dependencies", async () => {
    const { stdout, exitCode } = await runClient(["traverse", "order", "--type", "depends-on", "--tenant", tenant]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    expect(data.some((a) => a.slug === "customer")).toBe(true);
  });
});

// ==========================================================================
// Block 3: Multi-tenant daemon
// ==========================================================================
describe("Multi-tenant daemon", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  let port: number;

  function runClient(args: string[]) {
    return runCli(args, { PRAMANA_PORT: String(port) });
  }

  beforeAll(async () => {
    port = randomPort();
    daemonProc = Bun.spawn(
      [
        "bun", "run", CLI_PATH, "serve",
        "--source", `${FIXTURES_DIR}:commerce`,
        "--source", `${FIXTURES_ALT_DIR}:notes`,
        "--port", String(port),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await waitForDaemon(port, "/v1/tenants");
  });

  afterAll(() => {
    daemonProc.kill();
  });

  // ---------- 3a: Tenant setup verification ----------
  describe("Tenant setup verification", () => {
    test("/v1/tenants returns both tenants", async () => {
      const { status, body } = await httpGet(port, "/v1/tenants");
      expect(status).toBe(200);
      expect(body.length).toBe(2);
      const commerce = body.find((t: any) => t.name === "commerce");
      const notes = body.find((t: any) => t.name === "notes");
      expect(commerce.artifactCount).toBeGreaterThanOrEqual(4);
      expect(notes.artifactCount).toBe(2);
    });

    test("list --tenant commerce returns commerce-only", async () => {
      const { stdout, exitCode } = await runClient(["list", "--tenant", "commerce"]);
      expect(exitCode).toBe(0);
      const slugs = (JSON.parse(stdout) as Array<{ slug: string }>).map((a) => a.slug);
      expect(slugs).toContain("order");
      expect(slugs).toContain("customer");
      expect(slugs).toContain("line-item");
      expect(slugs).toContain("shipping-info");
      expect(slugs).not.toContain("note");
      expect(slugs).not.toContain("category");
    });

    test("list --tenant notes returns notes-only", async () => {
      const { stdout, exitCode } = await runClient(["list", "--tenant", "notes"]);
      expect(exitCode).toBe(0);
      const slugs = (JSON.parse(stdout) as Array<{ slug: string }>).map((a) => a.slug);
      expect(slugs).toContain("note");
      expect(slugs).toContain("category");
      expect(slugs).not.toContain("order");
      expect(slugs).not.toContain("customer");
    });
  });

  // ---------- 3b: Query — Orient (list) ----------
  describe("Query — Orient (list)", () => {
    test("list --tags entity,commerce --tenant commerce filters correctly", async () => {
      const { stdout, exitCode } = await runClient([
        "list", "--tags", "entity,commerce", "--tenant", "commerce",
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as Array<{ slug: string; tags: string[] }>;
      expect(data.length).toBe(3);
      const slugs = data.map((a) => a.slug).sort();
      expect(slugs).toEqual(["customer", "line-item", "order"]);
    });

    test("list without --tenant returns error", async () => {
      const { stderr, exitCode } = await runClient(["list"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Specify tenant");
    });
  });

  // ---------- 3c: Query — Discover (search) ----------
  describe("Query — Discover (search)", () => {
    test("search 'purchase' --tenant commerce finds order", async () => {
      const { stdout, exitCode } = await runClient([
        "search", "purchase", "--tenant", "commerce",
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as Array<{ slug: string }>;
      expect(data.some((a) => a.slug === "order")).toBe(true);
    });

    test("search 'category' --tenant notes finds category", async () => {
      const { stdout, exitCode } = await runClient([
        "search", "category", "--tenant", "notes",
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as Array<{ slug: string }>;
      expect(data.some((a) => a.slug === "category")).toBe(true);
    });

    test("search cross-tenant isolation", async () => {
      const { stdout, exitCode } = await runClient([
        "search", "purchase", "--tenant", "notes",
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as Array<{ slug: string }>;
      expect(data.some((a) => a.slug === "order")).toBe(false);
    });
  });

  // ---------- 3d: Query — Focus (get) ----------
  describe("Query — Focus (get)", () => {
    test("get order --tenant commerce -> full artifact", async () => {
      const { stdout, exitCode } = await runClient(["get", "order", "--tenant", "commerce"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.slug).toBe("order");
      expect(data.title).toBe("Order");
      expect(data.tags).toContain("entity");
      expect(data.sections.length).toBeGreaterThanOrEqual(2);
      expect(data.focusedSection).toBeUndefined();
    });

    test("get order#attributes --tenant commerce -> section focus", async () => {
      const { stdout, exitCode } = await runClient([
        "get", "order#attributes", "--tenant", "commerce",
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.focusedSection).toBeDefined();
      expect(data.focusedSection.heading).toBe("Attributes");
      expect(data.focusedSection.id).toBe("attributes");
      expect(data.focusedSection.content).toBeTruthy();
    });

    test("get note --tenant notes -> full artifact", async () => {
      const { stdout, exitCode } = await runClient(["get", "note", "--tenant", "notes"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.slug).toBe("note");
    });

    test("get note#content --tenant notes -> section focus", async () => {
      const { stdout, exitCode } = await runClient([
        "get", "note#content", "--tenant", "notes",
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.focusedSection).toBeDefined();
      expect(data.focusedSection.heading).toBe("Content");
    });

    test("get order --tenant notes -> 404 (wrong tenant)", async () => {
      const { stderr, exitCode } = await runClient(["get", "order", "--tenant", "notes"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Not found");
    });

    test("get nonexistent --tenant commerce -> 404", async () => {
      const { exitCode } = await runClient(["get", "nonexistent", "--tenant", "commerce"]);
      expect(exitCode).toBe(1);
    });
  });

  // ---------- 3e: Query — Connect (traverse) ----------
  describe("Query — Connect (traverse)", () => {
    test("traverse order --type depends-on --tenant commerce", async () => {
      const { stdout, exitCode } = await runClient([
        "traverse", "order", "--type", "depends-on", "--tenant", "commerce",
      ]);
      expect(exitCode).toBe(0);
      const slugs = (JSON.parse(stdout) as Array<{ slug: string }>).map((a) => a.slug);
      expect(slugs).toContain("customer");
      expect(slugs).toContain("line-item");
      expect(slugs).toContain("shipping-info");
    });

    test("traverse order --type depends-on --depth 2 --tenant commerce", async () => {
      const { stdout, exitCode } = await runClient([
        "traverse", "order", "--type", "depends-on", "--depth", "2", "--tenant", "commerce",
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout) as Array<{ slug: string }>;
      expect(data.length).toBeGreaterThanOrEqual(3);
    });

    test("traverse note --tenant notes (no type filter)", async () => {
      const { stdout, exitCode } = await runClient([
        "traverse", "note", "--tenant", "notes",
      ]);
      expect(exitCode).toBe(0);
      const slugs = (JSON.parse(stdout) as Array<{ slug: string }>).map((a) => a.slug);
      expect(slugs).toContain("category");
    });

    test("traverse cross-tenant isolation", async () => {
      const { stdout, exitCode } = await runClient([
        "traverse", "order", "--type", "depends-on", "--tenant", "commerce",
      ]);
      expect(exitCode).toBe(0);
      const slugs = (JSON.parse(stdout) as Array<{ slug: string }>).map((a) => a.slug);
      expect(slugs).not.toContain("note");
      expect(slugs).not.toContain("category");
    });
  });

  // ---------- 3f: Reload semantics ----------
  describe("Reload semantics", () => {
    test("reload --tenant commerce succeeds", async () => {
      const { stdout, exitCode } = await runClient(["reload", "--tenant", "commerce"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.status).toBe("ok");
      expect(data.report.succeeded).toBeGreaterThanOrEqual(4);
    });

    test("reload --tenant notes succeeds", async () => {
      const { stdout, exitCode } = await runClient(["reload", "--tenant", "notes"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.status).toBe("ok");
      expect(data.report.succeeded).toBeGreaterThanOrEqual(2);
    });

    test("reload without --tenant returns error", async () => {
      const { stderr, exitCode } = await runClient(["reload"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Missing --tenant");
    });

    test("queries work after reload", async () => {
      await runClient(["reload", "--tenant", "commerce"]);
      const { stdout, exitCode } = await runClient(["get", "order", "--tenant", "commerce"]);
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout).slug).toBe("order");
    });

    test("POST /v1/commerce/reload via HTTP", async () => {
      const { status, body } = await httpPost(port, "/v1/commerce/reload");
      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.report.succeeded).toBeGreaterThan(0);
    });

    test("POST /v1/reload via HTTP returns 400", async () => {
      const { status, body } = await httpPost(port, "/v1/reload");
      expect(status).toBe(400);
      expect(body.error).toContain("Specify tenant");
    });
  });

  // ---------- 3g: No default tenant ----------
  describe("No default tenant", () => {
    test("get without --tenant returns error", async () => {
      const { stderr, exitCode } = await runClient(["get", "order"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Specify tenant");
    });

    test("list without --tenant returns error", async () => {
      const { stderr, exitCode } = await runClient(["list"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Specify tenant");
    });

    test("search without --tenant returns error", async () => {
      const { stderr, exitCode } = await runClient(["search", "purchase"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Specify tenant");
    });
  });

  // ---------- 3h: Error cases ----------
  describe("Error cases", () => {
    test("get without --tenant returns error", async () => {
      const { stderr, exitCode } = await runClient(["get", "note"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Specify tenant");
    });

    test("reload --tenant nonexistent -> error", async () => {
      const { exitCode } = await runClient(["reload", "--tenant", "nonexistent"]);
      expect(exitCode).toBe(1);
    });
  });

  // ---------- 3i: HTTP API direct ----------
  describe("HTTP API direct", () => {
    test("GET /v1/tenants", async () => {
      const { status, body } = await httpGet(port, "/v1/tenants");
      expect(status).toBe(200);
      expect(body.some((t: any) => t.name === "commerce")).toBe(true);
      expect(body.some((t: any) => t.name === "notes")).toBe(true);
    });

    test("GET /v1/commerce/get/order", async () => {
      const { status, body } = await httpGet(port, "/v1/commerce/get/order");
      expect(status).toBe(200);
      expect(body.slug).toBe("order");
    });

    test("GET /v1/notes/get/note", async () => {
      const { status, body } = await httpGet(port, "/v1/notes/get/note");
      expect(status).toBe(200);
      expect(body.slug).toBe("note");
    });

    test("GET /v1/commerce/get/note -> 404", async () => {
      const { status } = await httpGet(port, "/v1/commerce/get/note");
      expect(status).toBe(404);
    });

    test("GET /v1/commerce/search?q=purchase", async () => {
      const { status, body } = await httpGet(port, "/v1/commerce/search?q=purchase");
      expect(status).toBe(200);
      expect(body.some((a: any) => a.slug === "order")).toBe(true);
    });

    test("GET /v1/notes/list", async () => {
      const { status, body } = await httpGet(port, "/v1/notes/list");
      expect(status).toBe(200);
      const slugs = body.map((a: any) => a.slug);
      expect(slugs).toContain("note");
      expect(slugs).toContain("category");
    });

    test("OPTIONS /v1/tenants -> 204", async () => {
      const res = await fetch(`http://localhost:${port}/v1/tenants`, { method: "OPTIONS" });
      expect(res.status).toBe(204);
    });

    test("CORS headers present", async () => {
      const { headers } = await httpGet(port, "/v1/tenants");
      expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
      const methods = headers.get("Access-Control-Allow-Methods");
      expect(methods).toContain("GET");
      expect(methods).toContain("POST");
      expect(methods).toContain("OPTIONS");
    });
  });
});

// ==========================================================================
// Block 4: Author workflow with temp directory
// ==========================================================================
describe("Author workflow with temp directory", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  let port: number;
  let tmpDir: string;

  function runClient(args: string[]) {
    return runCli(args, { PRAMANA_PORT: String(port) });
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-author-"));
    fs.cpSync(FIXTURES_DIR, tmpDir, { recursive: true });

    port = randomPort();
    daemonProc = Bun.spawn(
      [
        "bun", "run", CLI_PATH, "serve",
        "--source", `${tmpDir}:authoring`,
        "--port", String(port),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await waitForDaemon(port, "/v1/version");
  });

  afterAll(() => {
    daemonProc.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("no author agent files exist initially", () => {
    const metaDir = path.join(tmpDir, "_meta");
    const exists = fs.existsSync(metaDir);
    if (exists) {
      const authors = fs.readdirSync(metaDir).filter((f) => f.startsWith("author-"));
      expect(authors).toHaveLength(0);
    }
  });

  test("create author agent file on disk", () => {
    const metaDir = path.join(tmpDir, "_meta");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, "author-domain.md"),
      [
        "---",
        "name: author-domain",
        "description: Domain knowledge author for commerce systems",
        "model: inherit",
        "---",
        "",
        "You are a domain knowledge expert specializing in commerce systems.",
        "",
        "## Style",
        "",
        "Write in a clear, formal style with precise definitions.",
        "",
      ].join("\n"),
    );

    expect(fs.existsSync(path.join(metaDir, "author-domain.md"))).toBe(true);
  });

  test("author agent files are NOT ingested into Pramana index", async () => {
    // Reload after creating the author agent file
    const reload = await runClient(["reload", "--tenant", "authoring"]);
    expect(reload.exitCode).toBe(0);

    // The author agent file should not appear as an artifact
    const { stdout, exitCode } = await runClient(["list", "--tenant", "authoring"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as Array<{ slug: string }>;
    const slugs = data.map((a) => a.slug);
    expect(slugs).not.toContain("author-domain");
    expect(slugs).not.toContain("_meta-author-domain");
  });

  test("multiple author agent files coexist on disk", () => {
    const metaDir = path.join(tmpDir, "_meta");
    fs.writeFileSync(
      path.join(metaDir, "author-api-docs.md"),
      [
        "---",
        "name: author-api-docs",
        "description: API documentation author",
        "model: inherit",
        "---",
        "",
        "You are an API documentation specialist.",
        "",
      ].join("\n"),
    );

    const authors = fs.readdirSync(metaDir).filter((f) => f.startsWith("author-"));
    expect(authors.sort()).toEqual(["author-api-docs.md", "author-domain.md"]);
  });

  test("create new artifact, reload, verify", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "payment.md"),
      [
        "---",
        "slug: payment",
        "tags: [entity, commerce]",
        "relationships:",
        "  depends-on: [order]",
        "---",
        "",
        "# Payment",
        "",
        "## Method",
        "",
        "Supports credit card and bank transfer.",
        "",
      ].join("\n"),
    );

    const reload = await runClient(["reload", "--tenant", "authoring"]);
    expect(reload.exitCode).toBe(0);

    const { stdout, exitCode } = await runClient(["get", "payment", "--tenant", "authoring"]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).slug).toBe("payment");
  });

  test("traverse new artifact follows dependencies", async () => {
    const { stdout, exitCode } = await runClient(["traverse", "payment", "--type", "depends-on", "--tenant", "authoring"]);
    expect(exitCode).toBe(0);
    const slugs = (JSON.parse(stdout) as Array<{ slug: string }>).map((a) => a.slug);
    expect(slugs).toContain("order");
  });

  test("existing data still queryable after reload", async () => {
    const { stdout, exitCode } = await runClient(["get", "order", "--tenant", "authoring"]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).slug).toBe("order");
  });
});
