import type { Reader } from "../engine/reader.ts";
import type { TenantManager } from "../engine/tenant.ts";
import { VERSION } from "../version.ts";

export type ApiServerOptions = { port: number; tenantManager: TenantManager };

export function createServer(opts: ApiServerOptions) {
  const tm = opts.tenantManager;

  return Bun.serve({
    port: opts.port,

    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // POST /v1/:tenant/reload
      // POST /v1/reload → error
      if (req.method === "POST") {
        const tenantReloadMatch = path.match(/^\/v1\/([^/]+)\/reload$/);
        if (tenantReloadMatch) {
          const tenant = tenantReloadMatch[1]!;
          return handleReload(tm, tenant);
        }
        if (path === "/v1/reload") {
          const names = tm.tenantNames();
          return json(
            { error: `Specify tenant: POST /v1/:tenant/reload. Available: ${names.join(", ")}` },
            400,
          );
        }
        return json({ error: "Not found" }, 404);
      }

      // GET /v1/version
      if (path === "/v1/version") {
        return json({ version: `v${VERSION}` });
      }

      // GET /v1/tenants
      if (path === "/v1/tenants") {
        return json(tm.listTenants());
      }

      // Try tenant-scoped routing: /v1/:tenant/...
      const tenantMatch = path.match(/^\/v1\/([^/]+)\/(.+)$/);
      if (tenantMatch && tm.hasTenant(tenantMatch[1]!)) {
        const tenant = tenantMatch[1]!;
        const rest = tenantMatch[2]!;
        const result = tm.getReader(tenant);
        if (!result.ok) return json({ error: `Tenant "${tenant}" not found` }, 404);
        return await handleOperation(result.value, rest, url);
      }

      // Unscoped /v1/... paths → error with available tenant names
      const unscopedMatch = path.match(/^\/v1\/(.+)$/);
      if (unscopedMatch) {
        const names = tm.tenantNames();
        return json(
          {
            error: `Specify tenant in URL: /v1/:tenant/${unscopedMatch[1]}. Available: ${names.join(", ")}`,
          },
          400,
        );
      }

      return json({ error: "Not found" }, 404);
    },
  });
}

async function handleOperation(reader: Reader, opPath: string, url: URL): Promise<Response> {
  // get/:slug/:section
  const sectionGet = opPath.match(/^get\/([^/]+)\/(.+)$/);
  if (sectionGet) {
    const [, slug, section] = sectionGet;
    const result = reader.get(`${slug}#${section}`);
    if (!result.ok) return json({ error: result.error.message }, 500);
    if (!result.value) return json({ error: "Not found" }, 404);
    return json(result.value);
  }

  // get/:slug
  const getMatch = opPath.match(/^get\/([^/]+)$/);
  if (getMatch) {
    const slug = getMatch[1]!;
    const result = reader.get(slug);
    if (!result.ok) return json({ error: result.error.message }, 500);
    if (!result.value) return json({ error: "Not found" }, 404);
    return json(result.value);
  }

  // search?q=
  if (opPath === "search") {
    const query = url.searchParams.get("q");
    if (!query) return json({ error: "Missing query parameter 'q'" }, 400);
    const result = await reader.search(query);
    if (!result.ok) return json({ error: result.error.message }, 500);
    return json(result.value);
  }

  // traverse/:from
  const traverseMatch = opPath.match(/^traverse\/([^/]+)$/);
  if (traverseMatch) {
    const from = traverseMatch[1]!;
    const relType = url.searchParams.get("type") ?? undefined;
    const depth = parseInt(url.searchParams.get("depth") ?? "1", 10);
    const result = reader.traverse(from, relType, depth);
    if (!result.ok) return json({ error: result.error.message }, 500);
    return json(result.value);
  }

  // list
  if (opPath === "list") {
    const tagsParam = url.searchParams.get("tags");
    const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()) : undefined;
    const result = reader.list(tags ? { tags } : undefined);
    if (!result.ok) return json({ error: result.error.message }, 500);
    return json(result.value);
  }

  return json({ error: "Not found" }, 404);
}

async function handleReload(tm: TenantManager, tenantName: string): Promise<Response> {
  const result = await tm.reload(tenantName);
  if (!result.ok) return json({ error: result.error.message }, 500);
  return json({ status: "ok", report: result.value });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}
