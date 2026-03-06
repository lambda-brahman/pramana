#!/usr/bin/env bun
import { SqlitePlugin } from "../storage/sqlite/index.ts";
import { Builder } from "../engine/builder.ts";
import { Reader } from "../engine/reader.ts";
import { createServer } from "../api/server.ts";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function usage(): never {
  console.log(`pramana — Knowledge Engine

Usage:
  pramana serve --source <dir> [--port 3000]
  pramana get <slug> --source <dir>
  pramana search <query> --source <dir>
  pramana traverse <slug> --source <dir> [--type <rel-type>] [--depth <n>]
  pramana list --source <dir> [--tags <tag1,tag2>]`);
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

async function main() {
  if (!command) usage();

  const sourceDir = getFlag("source");
  if (!sourceDir) {
    console.error("Missing --source <dir>");
    process.exit(1);
  }

  const { storage, reader } = await buildEngine(sourceDir);

  switch (command) {
    case "serve": {
      const port = parseInt(getFlag("port") ?? "3000", 10);
      const server = createServer({ port, reader });
      console.log(`Pramana serving on http://localhost:${server.port}`);
      break;
    }

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
