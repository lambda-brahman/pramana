import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.ts";
import { VERSION } from "../version.ts";

export type McpServerOptions = { port: number };

type DaemonError = { type: "daemon-unreachable" | "not-found" | "server-error"; message: string };

const DAEMON_UNREACHABLE_MSG = "Pramana daemon not running. Start it with: pramana serve";

function safeJsonParse(text: string): { error?: string } | null {
  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return null;
  }
}

async function daemonFetch(port: number, path: string): Promise<Result<unknown, DaemonError>> {
  let res: Response;
  try {
    res = await fetch(`http://localhost:${port}${path}`);
  } catch {
    return err({ type: "daemon-unreachable", message: DAEMON_UNREACHABLE_MSG });
  }

  const text = await res.text();

  if (res.status === 404) {
    const body = safeJsonParse(text);
    return err({
      type: "not-found",
      message: body?.error ?? "Not found",
    });
  }

  if (!res.ok) {
    const body = safeJsonParse(text);
    return err({
      type: "server-error",
      message: body?.error ?? `Daemon returned ${res.status}`,
    });
  }

  const parsed = safeJsonParse(text);
  if (parsed === null) {
    return err({
      type: "server-error",
      message: `Daemon returned invalid JSON (status ${res.status})`,
    });
  }

  return ok(parsed);
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function successResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function handleDaemonResult(result: Result<unknown, DaemonError>): CallToolResult {
  if (!result.ok) return errorResult(result.error.message);
  return successResult(result.value);
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const { port } = opts;

  const server = new McpServer(
    { name: "pramana", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.tool("list-tenants", "List all available knowledge tenants", async () => {
    return handleDaemonResult(await daemonFetch(port, "/v1/tenants"));
  });

  server.tool(
    "get",
    "Get a knowledge artifact by slug",
    {
      tenant: z.string().describe("Tenant name"),
      slug: z.string().describe("Artifact slug"),
      section: z.string().optional().describe("Optional section heading"),
    },
    async ({ tenant, slug, section }) => {
      const path = section
        ? `/v1/${encodeURIComponent(tenant)}/get/${encodeURIComponent(slug)}/${encodeURIComponent(section)}`
        : `/v1/${encodeURIComponent(tenant)}/get/${encodeURIComponent(slug)}`;
      return handleDaemonResult(await daemonFetch(port, path));
    },
  );

  server.tool(
    "search",
    "Search knowledge artifacts by query",
    {
      tenant: z.string().describe("Tenant name"),
      query: z.string().describe("Search query"),
    },
    async ({ tenant, query }) => {
      const path = `/v1/${encodeURIComponent(tenant)}/search?q=${encodeURIComponent(query)}`;
      return handleDaemonResult(await daemonFetch(port, path));
    },
  );

  server.tool(
    "traverse",
    "Traverse relationships from a knowledge artifact",
    {
      tenant: z.string().describe("Tenant name"),
      from: z.string().describe("Starting artifact slug"),
      type: z.string().optional().describe("Relationship type filter"),
      depth: z.number().int().nonnegative().optional().describe("Traversal depth (default: 1)"),
    },
    async ({ tenant, from, type, depth }) => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (depth !== undefined) params.set("depth", String(depth));
      const qs = params.toString();
      const path = `/v1/${encodeURIComponent(tenant)}/traverse/${encodeURIComponent(from)}${qs ? `?${qs}` : ""}`;
      return handleDaemonResult(await daemonFetch(port, path));
    },
  );

  server.tool(
    "list",
    "List knowledge artifacts, optionally filtered by tags",
    {
      tenant: z.string().describe("Tenant name"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
    },
    async ({ tenant, tags }) => {
      const params = new URLSearchParams();
      if (tags && tags.length > 0) params.set("tags", tags.join(","));
      const qs = params.toString();
      const path = `/v1/${encodeURIComponent(tenant)}/list${qs ? `?${qs}` : ""}`;
      return handleDaemonResult(await daemonFetch(port, path));
    },
  );

  return server;
}

export async function startMcpServer(opts: McpServerOptions): Promise<void> {
  const server = createMcpServer(opts);
  const transport = new StdioServerTransport();

  transport.onerror = () => {
    process.exit(1);
  };

  transport.onclose = () => {
    process.exit(0);
  };

  await server.connect(transport);
}
