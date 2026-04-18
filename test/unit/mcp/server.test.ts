import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../../src/mcp/server.ts";

const PORT = 19876;

function mockDaemon(
  handler: (req: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    fetch: handler,
  });
}

async function createTestClient() {
  const server = createMcpServer({ port: PORT });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server tool schemas", () => {
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeAll(async () => {
    const pair = await createTestClient();
    client = pair.client;
    server = pair.server;
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  test("lists all five tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get", "list", "list-tenants", "search", "traverse"]);
  });

  test("list-tenants has no required parameters", async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "list-tenants")!;
    expect(tool.inputSchema.required ?? []).toEqual([]);
  });

  test("get requires tenant and slug", async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "get")!;
    expect(tool.inputSchema.required).toContain("tenant");
    expect(tool.inputSchema.required).toContain("slug");
  });

  test("search requires tenant and query", async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "search")!;
    expect(tool.inputSchema.required).toContain("tenant");
    expect(tool.inputSchema.required).toContain("query");
  });

  test("traverse requires tenant and from", async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "traverse")!;
    expect(tool.inputSchema.required).toContain("tenant");
    expect(tool.inputSchema.required).toContain("from");
  });

  test("list requires tenant", async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "list")!;
    expect(tool.inputSchema.required).toContain("tenant");
  });
});

describe("MCP server proxy — success paths", () => {
  let daemon: ReturnType<typeof Bun.serve>;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeAll(async () => {
    daemon = mockDaemon((req) => {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/v1/tenants") {
        return Response.json([
          { name: "commerce", artifactCount: 4 },
          { name: "notes", artifactCount: 2 },
        ]);
      }

      if (path === "/v1/commerce/get/order") {
        return Response.json({ slug: "order", title: "Order", tags: ["entity"] });
      }

      if (path === "/v1/commerce/get/order/attributes") {
        return Response.json({
          slug: "order",
          focusedSection: { heading: "Attributes" },
        });
      }

      if (path === "/v1/commerce/search" && url.searchParams.get("q") === "purchase") {
        return Response.json([{ slug: "order", title: "Order" }]);
      }

      if (path === "/v1/commerce/traverse/order") {
        return Response.json([{ slug: "customer", title: "Customer" }]);
      }

      if (path === "/v1/commerce/list") {
        const tags = url.searchParams.get("tags");
        if (tags === "entity") {
          return Response.json([{ slug: "order", tags: ["entity"] }]);
        }
        return Response.json([
          { slug: "order" },
          { slug: "customer" },
          { slug: "line-item" },
        ]);
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    });

    const pair = await createTestClient();
    client = pair.client;
    server = pair.server;
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    daemon.stop(true);
  });

  test("list-tenants returns tenants", async () => {
    const result = await client.callTool({ name: "list-tenants", arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe("commerce");
  });

  test("get returns artifact", async () => {
    const result = await client.callTool({
      name: "get",
      arguments: { tenant: "commerce", slug: "order" },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data.slug).toBe("order");
    expect(data.title).toBe("Order");
  });

  test("get with section returns focused section", async () => {
    const result = await client.callTool({
      name: "get",
      arguments: { tenant: "commerce", slug: "order", section: "attributes" },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data.focusedSection.heading).toBe("Attributes");
  });

  test("search returns results", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { tenant: "commerce", query: "purchase" },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data[0].slug).toBe("order");
  });

  test("traverse returns related artifacts", async () => {
    const result = await client.callTool({
      name: "traverse",
      arguments: { tenant: "commerce", from: "order", type: "depends-on" },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data[0].slug).toBe("customer");
  });

  test("list returns artifacts", async () => {
    const result = await client.callTool({
      name: "list",
      arguments: { tenant: "commerce" },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data.length).toBe(3);
  });

  test("list with tags filters results", async () => {
    const result = await client.callTool({
      name: "list",
      arguments: { tenant: "commerce", tags: ["entity"] },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data[0].tags).toContain("entity");
  });
});

describe("MCP server proxy — error paths", () => {
  test("daemon unreachable returns MCP error", async () => {
    const server = createMcpServer({ port: 19999 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "list-tenants", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("Pramana daemon not running");
    expect(text).toContain("pramana serve");

    await client.close();
    await server.close();
  });

  test("daemon 404 returns not-found error", async () => {
    const daemon = mockDaemon(() => {
      return Response.json({ error: 'Tenant "missing" not found' }, { status: 404 });
    });

    const server = createMcpServer({ port: PORT });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get",
      arguments: { tenant: "missing", slug: "nonexistent" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("missing");

    await client.close();
    await server.close();
    daemon.stop(true);
  });

  test("daemon 500 returns error message verbatim", async () => {
    const daemon = mockDaemon(() => {
      return Response.json({ error: "Internal engine failure" }, { status: 500 });
    });

    const server = createMcpServer({ port: PORT });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "search",
      arguments: { tenant: "test", query: "anything" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toBe("Internal engine failure");

    await client.close();
    await server.close();
    daemon.stop(true);
  });
});
