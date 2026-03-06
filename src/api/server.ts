import type { Reader } from "../engine/reader.ts";

export type ApiServerOptions = {
  port: number;
  reader: Reader;
};

export function createServer({ port, reader }: ApiServerOptions) {
  return Bun.serve({
    port,
    routes: {
      "/v1/get/:slug": (req) => {
        const slug = req.params.slug;
        const result = reader.get(slug);
        if (!result.ok) return json({ error: result.error.message }, 500);
        if (!result.value) return json({ error: "Not found" }, 404);
        return json(result.value);
      },

      "/v1/search": (req) => {
        const url = new URL(req.url);
        const query = url.searchParams.get("q");
        if (!query) return json({ error: "Missing query parameter 'q'" }, 400);

        const result = reader.search(query);
        if (!result.ok) return json({ error: result.error.message }, 500);
        return json(result.value);
      },

      "/v1/traverse/:from": (req) => {
        const from = req.params.from;
        const url = new URL(req.url);
        const relType = url.searchParams.get("type") ?? undefined;
        const depth = parseInt(url.searchParams.get("depth") ?? "1", 10);

        const result = reader.traverse(from, relType, depth);
        if (!result.ok) return json({ error: result.error.message }, 500);
        return json(result.value);
      },

      "/v1/list": (req) => {
        const url = new URL(req.url);
        const tagsParam = url.searchParams.get("tags");
        const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()) : undefined;

        const result = reader.list(tags ? { tags } : undefined);
        if (!result.ok) return json({ error: result.error.message }, 500);
        return json(result.value);
      },
    },

    fetch(req) {
      // Section-based get: /v1/get/slug/section-id
      const url = new URL(req.url);
      const sectionGetMatch = url.pathname.match(/^\/v1\/get\/([^/]+)\/(.+)$/);
      if (sectionGetMatch) {
        const [, slug, section] = sectionGetMatch;
        const result = reader.get(`${slug}#${section}`);
        if (!result.ok) return json({ error: result.error.message }, 500);
        if (!result.value) return json({ error: "Not found" }, 404);
        return json(result.value);
      }

      return json({ error: "Not found" }, 404);
    },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
