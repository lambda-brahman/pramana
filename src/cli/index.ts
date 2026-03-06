#!/usr/bin/env bun
import { SqlitePlugin } from "../storage/sqlite/index.ts";
import { Builder } from "../engine/builder.ts";
import { Reader } from "../engine/reader.ts";
import { TenantManager } from "../engine/tenant.ts";
import { createServer } from "../api/server.ts";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getAllFlags(name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) {
      values.push(args[i + 1]!);
    }
  }
  return values;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function parseSources(): Array<{ path: string; name: string }> {
  const raw = getAllFlags("source");
  return raw.map((s) => {
    const lastColon = s.lastIndexOf(":");
    if (lastColon > 0) {
      const p = s.slice(0, lastColon);
      const n = s.slice(lastColon + 1);
      if (n.length > 0) return { path: p, name: n };
    }
    // No colon or empty name — use basename
    const parts = s.replace(/\/+$/, "").split("/");
    return { path: s, name: parts[parts.length - 1]! };
  });
}

function usage(): never {
  console.log(`pramana — Knowledge Engine

Usage:
  pramana serve --source <dir>[:name] [--source <dir>[:name] ...] [--port 3000]
  pramana get <slug> --source <dir> [--tenant <name>]
  pramana search <query> --source <dir> [--tenant <name>]
  pramana traverse <slug> --source <dir> [--type <rel-type>] [--depth <n>] [--tenant <name>]
  pramana list --source <dir> [--tags <tag1,tag2>] [--tenant <name>]
  pramana reload [--tenant <name>]

Options:
  --standalone    Force rebuild mode (skip server detection)
  --port <n>      Server port (default: PRAMANA_PORT env or 3000)
  --tenant <name> Target a specific tenant (multi-tenant mode)
  --source <dir>[:name]  Knowledge source directory (repeatable for multi-tenant)

Multi-tenant serve:
  pramana serve --source ./law:law --source ./music:music --port 3000`);
  process.exit(1);
}

async function buildEngine(sourceDir: string) {
  const storage = new SqlitePlugin(":memory:");
  const initResult = storage.initialize();
  if (!initResult.ok) {
    console.error("Storage init failed:", initResult.error.message);
    process.exit(1);
  }

  const builder = new Builder(storage);
  const buildResult = await builder.build(sourceDir);
  if (!buildResult.ok) {
    console.error("Build failed:", buildResult.error.message);
    process.exit(1);
  }

  const report = buildResult.value;
  console.error(
    `Ingested ${report.succeeded}/${report.total} files` +
      (report.failed.length > 0
        ? ` (${report.failed.length} failed)`
        : "")
  );

  for (const f of report.failed) {
    console.error(`  ✗ ${f.file}: ${f.error.message}`);
  }

  const reader = new Reader(storage, storage);
  return { storage, reader };
}

function resolvePort(): string {
  return getFlag("port") ?? process.env.PRAMANA_PORT ?? "3000";
}

async function isServerReachable(port: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`http://localhost:${port}/v1/list`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function httpClient(port: string): Promise<void> {
  const baseUrl = `http://localhost:${port}`;
  const tenant = getFlag("tenant");
  const prefix = tenant ? `${baseUrl}/v1/${tenant}` : `${baseUrl}/v1`;

  let url: string;
  let method = "GET";

  switch (command) {
    case "get": {
      const slug = args[1];
      if (!slug) { console.error("Missing slug"); process.exit(1); }
      const parts = slug.split("#");
      url = parts.length > 1
        ? `${prefix}/get/${parts[0]}/${parts[1]}`
        : `${prefix}/get/${slug}`;
      break;
    }
    case "search": {
      const query = args[1];
      if (!query) { console.error("Missing query"); process.exit(1); }
      url = `${prefix}/search?q=${encodeURIComponent(query)}`;
      break;
    }
    case "traverse": {
      const slug = args[1];
      if (!slug) { console.error("Missing slug"); process.exit(1); }
      const params = new URLSearchParams();
      const relType = getFlag("type");
      if (relType) params.set("type", relType);
      params.set("depth", getFlag("depth") ?? "1");
      url = `${prefix}/traverse/${slug}?${params}`;
      break;
    }
    case "list": {
      const tagsStr = getFlag("tags");
      const params = new URLSearchParams();
      if (tagsStr) params.set("tags", tagsStr);
      url = `${prefix}/list${tagsStr ? `?${params}` : ""}`;
      break;
    }
    case "reload": {
      const reloadTenant = getFlag("tenant");
      url = reloadTenant
        ? `${baseUrl}/v1/${reloadTenant}/reload`
        : `${baseUrl}/v1/reload`;
      method = "POST";
      break;
    }
    default:
      usage();
  }

  const res = await fetch(url, { method });
  const body = await res.text();

  if (!res.ok) {
    const parsed = JSON.parse(body) as { error?: string };
    console.error(parsed.error ?? "Request failed");
    process.exit(1);
  }

  console.log(body);
}

async function main() {
  if (!command) usage();

  const standalone = hasFlag("standalone");
  const port = resolvePort();

  // serve always needs source — it IS the daemon
  if (command === "serve") {
    const sources = parseSources();
    if (sources.length === 0) {
      console.error("Missing --source <dir>");
      process.exit(1);
    }

    const tm = new TenantManager();
    for (const src of sources) {
      const result = await tm.mount({ name: src.name, sourceDir: src.path });
      if (!result.ok) {
        console.error(`Failed to mount "${src.name}": ${result.error.message}`);
        process.exit(1);
      }
      const report = result.value;
      console.error(
        `[${src.name}] Ingested ${report.succeeded}/${report.total} files` +
          (report.failed.length > 0
            ? ` (${report.failed.length} failed)`
            : "")
      );
      for (const f of report.failed) {
        console.error(`  ✗ ${f.file}: ${f.error.message}`);
      }
    }

    const portNum = parseInt(port, 10);
    const server = createServer({ port: portNum, tenantManager: tm });
    console.log(`Pramana serving on http://localhost:${server.port}`);
    return;
  }

  // reload only works via daemon
  if (command === "reload") {
    const reachable = await isServerReachable(port);
    if (!reachable) {
      console.error("No running daemon found. Reload requires a running daemon.");
      process.exit(1);
    }
    await httpClient(port);
    return;
  }

  // Client mode: try connecting to running daemon (unless --standalone)
  if (!standalone) {
    const reachable = await isServerReachable(port);
    if (reachable) {
      await httpClient(port);
      return;
    }
  }

  // Fallback: standalone rebuild
  const sourceDir = getFlag("source");
  if (!sourceDir) {
    console.error("Missing --source <dir> (no running daemon found)");
    process.exit(1);
  }

  const { storage, reader } = await buildEngine(sourceDir);

  switch (command) {
    case "get": {
      const slug = args[1];
      if (!slug) { console.error("Missing slug"); process.exit(1); }
      const result = reader.get(slug);
      if (!result.ok) { console.error(result.error.message); process.exit(1); }
      if (!result.value) { console.error("Not found"); process.exit(1); }
      console.log(JSON.stringify(result.value, null, 2));
      storage.close();
      break;
    }

    case "search": {
      const query = args[1];
      if (!query) { console.error("Missing query"); process.exit(1); }
      const result = reader.search(query);
      if (!result.ok) { console.error(result.error.message); process.exit(1); }
      console.log(JSON.stringify(result.value, null, 2));
      storage.close();
      break;
    }

    case "traverse": {
      const slug = args[1];
      if (!slug) { console.error("Missing slug"); process.exit(1); }
      const relType = getFlag("type");
      const depth = parseInt(getFlag("depth") ?? "1", 10);
      const result = reader.traverse(slug, relType, depth);
      if (!result.ok) { console.error(result.error.message); process.exit(1); }
      console.log(JSON.stringify(result.value, null, 2));
      storage.close();
      break;
    }

    case "list": {
      const tagsStr = getFlag("tags");
      const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : undefined;
      const result = reader.list(tags ? { tags } : undefined);
      if (!result.ok) { console.error(result.error.message); process.exit(1); }
      console.log(JSON.stringify(result.value, null, 2));
      storage.close();
      break;
    }

    default:
      usage();
  }
}

main();
