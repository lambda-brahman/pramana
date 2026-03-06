import type { Reader } from "../engine/reader.ts";
import type { TenantManager } from "../engine/tenant.ts";

export type ApiServerOptions =
  | { port: number; tenantManager: TenantManager }
  | { port: number; reader: Reader };

export function createServer(opts: ApiServerOptions) {
  const tm = "tenantManager" in opts ? opts.tenantManager : null;
  const singleReader = "reader" in opts ? opts.reader : null;

  function getReader(tenantName?: string): Reader | null {
    if (tm) {
      const result = tenantName
        ? tm.getReader(tenantName)
        : tm.getDefaultReader();
      return result.ok ? result.value : null;
    }
    return singleReader;
  }

  function isTenant(segment: string): boolean {
    return tm ? tm.hasTenant(segment) : false;
  }

  return Bun.serve({
    port: opts.port,

    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // POST /v1/:tenant/reload
      // POST /v1/reload
      if (req.method === "POST") {
        const tenantReloadMatch = path.match(/^\/v1\/([^/]+)\/reload$/);
        if (tenantReloadMatch) {
          const tenant = tenantReloadMatch[1]!;
          return handleReload(tm, tenant);
        }
        if (path === "/v1/reload") {
          const defaultName = tm?.defaultTenantName();
          if (!defaultName) return json({ error: "No default tenant" }, 400);
          return handleReload(tm, defaultName);
        }
        return json({ error: "Not found" }, 404);
      }

      // GET /v1/tenants
      if (path === "/v1/tenants" && tm) {
        return json(tm.listTenants());
      }

      // Try tenant-scoped routing: /v1/:tenant/...
      const tenantMatch = path.match(/^\/v1\/([^/]+)\/(.+)$/);
      if (tenantMatch && isTenant(tenantMatch[1]!)) {
        const tenant = tenantMatch[1]!;
        const rest = tenantMatch[2]!;
        const reader = getReader(tenant);
        if (!reader) return json({ error: `Tenant "${tenant}" not found` }, 404);
        return handleOperation(reader, rest, url);
      }

      // Default tenant routing: /v1/...
      const defaultMatch = path.match(/^\/v1\/(.+)$/);
      if (defaultMatch) {
        const rest = defaultMatch[1]!;
        const reader = getReader();
        if (!reader) return json({ error: "No default tenant" }, 404);
        return handleOperation(reader, rest, url);
      }

      return json({ error: "Not found" }, 404);
    },
  });
}

function handleOperation(reader: Reader, opPath: string, url: URL): Response {
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
    const result = reader.search(query);
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

async function handleReload(
  tm: TenantManager | null,
  tenantName: string
): Promise<Response> {
  if (!tm) return json({ error: "Reload not supported in single-reader mode" }, 400);
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
