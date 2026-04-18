import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");
const FIXTURES_ALT_DIR = path.join(import.meta.dir, "../fixtures-alt");
const CLI_PATH = path.join(import.meta.dir, "../../src/cli/index.ts");

async function waitForDaemon(port: number, maxWait = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://localhost:${port}/v1/tenants`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`Daemon on port ${port} did not start in time`);
}

type McpClient = {
  rpc: (id: number, method: string, params?: unknown) => Promise<unknown>;
  notify: (method: string, params?: unknown) => void;
  kill: () => void;
};

function startMcpProcess(port: number): McpClient {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "mcp", "--port", String(port)], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const pending: string[] = [];
  let textBuffer = "";

  (async () => {
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = textBuffer.indexOf("\n")) !== -1) {
          const line = textBuffer.slice(0, nl).trimEnd();
          textBuffer = textBuffer.slice(nl + 1);
          if (line) pending.push(line);
        }
      }
    } catch {
      // stream closed
    }
  })();

  function write(msg: unknown) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  async function nextResponseFor(id: number, timeout = 8000): Promise<unknown> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const idx = pending.findIndex((l) => {
        try {
          return (JSON.parse(l) as { id?: unknown }).id === id;
        } catch {
          return false;
        }
      });
      if (idx !== -1) return JSON.parse(pending.splice(idx, 1)[0] as string);
      await Bun.sleep(50);
    }
    throw new Error(`MCP timeout waiting for response id=${id}`);
  }

  function rpc(id: number, method: string, params?: unknown): Promise<unknown> {
    write({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    return nextResponseFor(id);
  }

  function notify(method: string, params?: unknown) {
    write({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
  }

  return { rpc, notify, kill: () => proc.kill() };
}

async function initializeMcp(mcp: McpClient): Promise<void> {
  await mcp.rpc(0, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0" },
  });
  mcp.notify("notifications/initialized");
}

describe("MCP E2E — stdio round-trip with 2 tenants", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  let port: number;
  let mcp: McpClient;

  beforeAll(async () => {
    port = 30000 + Math.floor(Math.random() * 10000);

    daemonProc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "serve",
        "--source",
        `${FIXTURES_DIR}:commerce`,
        "--source",
        `${FIXTURES_ALT_DIR}:notes`,
        "--port",
        String(port),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    await waitForDaemon(port);

    mcp = startMcpProcess(port);
    await initializeMcp(mcp);
  });

  afterAll(() => {
    mcp.kill();
    daemonProc.kill();
  });

  test("list-tenants returns both tenants", async () => {
    const response = (await mcp.rpc(1, "tools/call", {
      name: "list-tenants",
      arguments: {},
    })) as { result: { isError?: boolean; content: [{ text: string }, ...{ text: string }[]] } };

    expect(response.result).toBeDefined();
    expect(response.result.isError).toBeFalsy();

    const data = JSON.parse(response.result.content[0].text) as Array<{ name: string }>;
    expect(data.some((t) => t.name === "commerce")).toBe(true);
    expect(data.some((t) => t.name === "notes")).toBe(true);
  });

  test("get returns artifact from tenant", async () => {
    const response = (await mcp.rpc(2, "tools/call", {
      name: "get",
      arguments: { tenant: "commerce", slug: "order" },
    })) as { result: { isError?: boolean; content: [{ text: string }, ...{ text: string }[]] } };

    expect(response.result).toBeDefined();
    expect(response.result.isError).toBeFalsy();

    const data = JSON.parse(response.result.content[0].text) as Record<string, unknown>;
    expect(data.slug).toBe("order");
    expect(data.title).toBe("Order");
  });

  test("search returns results matching query", async () => {
    const response = (await mcp.rpc(3, "tools/call", {
      name: "search",
      arguments: { tenant: "commerce", query: "purchase" },
    })) as { result: { isError?: boolean; content: [{ text: string }, ...{ text: string }[]] } };

    expect(response.result).toBeDefined();
    expect(response.result.isError).toBeFalsy();

    const data = JSON.parse(response.result.content[0].text) as Array<{ slug: string }>;
    expect(data.some((r) => r.slug === "order")).toBe(true);
  });
});

describe("MCP E2E — error when daemon stopped mid-session", () => {
  let daemonProc: ReturnType<typeof Bun.spawn>;
  let port: number;
  let mcp: McpClient;

  beforeAll(async () => {
    port = 30000 + Math.floor(Math.random() * 10000);

    daemonProc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "serve",
        "--source",
        `${FIXTURES_DIR}:commerce`,
        "--port",
        String(port),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    await waitForDaemon(port);

    mcp = startMcpProcess(port);
    await initializeMcp(mcp);
  });

  afterAll(() => {
    mcp.kill();
  });

  test("returns isError when daemon is stopped mid-session", async () => {
    daemonProc.kill();
    await Bun.sleep(300);

    const response = (await mcp.rpc(1, "tools/call", {
      name: "list-tenants",
      arguments: {},
    })) as { result: { isError?: boolean; content: [{ text: string }, ...{ text: string }[]] } };

    expect(response.result).toBeDefined();
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("not running");
  });
});
