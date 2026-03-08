#!/usr/bin/env bun
import { basename, resolve } from "node:path";
import { createServer } from "../api/server.ts";
import {
  addTenant as configAddTenant,
  configPath,
  removeTenant as configRemoveTenant,
  loadConfig,
} from "../config/index.ts";
import { TenantManager } from "../engine/tenant.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { NAME_REGEX, RESERVED_NAMES } from "../lib/tenant-names.ts";
import { compareSemver, VERSION } from "../version.ts";
import { formatDiagnostics, lintFromDaemon, lintSource } from "./lint.ts";

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
    return { path: s, name: basename(s) };
  });
}

function usage(exitCode = 0): never {
  console.log(`pramana ${VERSION} — Knowledge Engine

Usage:
  pramana serve [--source <dir>[:name] ...] [--port 5111] [--save]
  pramana get <slug> --source <dir> --tenant <name>
  pramana search <query> --source <dir> --tenant <name>
  pramana traverse <slug> --source <dir> [--type <rel-type>] [--depth <n>] --tenant <name>
  pramana list --source <dir> [--tags <tag1,tag2>] --tenant <name>
  pramana tui [--source <dir>[:name] ...] [--port 5111]
  pramana lint --source <dir> [--strict]
  pramana lint --tenant <name> [--strict]
  pramana reload --tenant <name>
  pramana config add <name> <dir>
  pramana config remove <name>
  pramana config list
  pramana config path
  pramana version [--check]
  pramana upgrade

Options:
  --standalone    Force rebuild mode (skip server detection)
  --port <n>      Server port (default: PRAMANA_PORT env or 5111)
  --tenant <name> Target a specific tenant (required for all queries)
  --source <dir>[:name]  Knowledge source directory (repeatable for multi-tenant)
  --save          Persist CLI sources to config after successful mount
  --version       Show version
  --help          Show this help

Multi-tenant serve:
  pramana serve --source ./law:law --source ./music:music --port 5111`);
  process.exit(exitCode);
}

type CliError = { type: "cli"; message: string };

async function checkLatest(): Promise<
  Result<{ latest: string; current: string; upgradeAvailable: boolean }, CliError>
> {
  const current = VERSION;
  const res = await fetch("https://api.github.com/repos/lambda-brahman/pramana/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return err({ type: "cli", message: `GitHub API returned ${res.status}` });
  const data = (await res.json()) as { tag_name: string };
  const latest = data.tag_name;
  return ok({ latest, current, upgradeAvailable: compareSemver(latest, current) > 0 });
}

function platformLabel(): string {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

async function performUpgrade(targetVersion: string): Promise<Result<void, CliError>> {
  const os = platformLabel();
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const ext = process.platform === "win32" ? ".exe" : "";
  const binary = `pramana-${os}-${arch}${ext}`;
  const url = `https://github.com/lambda-brahman/pramana/releases/download/${targetVersion}/${binary}`;

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return err({ type: "cli", message: `Download failed: ${res.status}` });

  const execPath = process.execPath;
  const tmpPath = `${execPath}.upgrade-tmp`;
  const isWindows = process.platform === "win32";

  const { chmodSync, renameSync, unlinkSync } = await import("node:fs");

  // Clean up leftover .old from previous Windows upgrade
  if (isWindows) {
    const oldPath = `${execPath}.old`;
    try {
      unlinkSync(oldPath);
    } catch {
      /* not present */
    }
  }

  await Bun.write(tmpPath, res);

  if (isWindows) {
    // Windows: can't overwrite running exe, but CAN rename it
    const oldPath = `${execPath}.old`;
    renameSync(execPath, oldPath);
    renameSync(tmpPath, execPath);
  } else {
    chmodSync(tmpPath, 0o755);
    renameSync(tmpPath, execPath);
  }

  return ok(undefined);
}

async function upgradePlugin(version: string): Promise<Result<void, CliError>> {
  const { mkdirSync, existsSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");

  const tarUrl = `https://github.com/lambda-brahman/pramana/releases/download/${version}/plugin.tar.gz`;
  const res = await fetch(tarUrl, { redirect: "follow" });
  if (!res.ok) {
    return err({ type: "cli", message: `Plugin download failed: ${res.status}` });
  }

  const home = homedir();
  const cacheDir = join(home, ".claude", "plugins", "cache", "lambda-brahman", "pramana", version);
  mkdirSync(cacheDir, { recursive: true });

  // Write tarball to temp file and extract
  const tarPath = join(cacheDir, "plugin.tar.gz");
  await Bun.write(tarPath, res);

  const extractResult = Bun.spawnSync(["tar", "xzf", tarPath, "-C", cacheDir]);
  if (extractResult.exitCode !== 0) {
    return err({ type: "cli", message: "Plugin extraction failed" });
  }

  // Clean up tarball
  const { unlinkSync } = await import("node:fs");
  try {
    unlinkSync(tarPath);
  } catch {
    /* ignore */
  }

  // Update installed_plugins.json
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  let installed: Record<string, unknown> = {};
  if (existsSync(installedPath)) {
    try {
      const text = await Bun.file(installedPath).text();
      installed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* start fresh */
    }
  }

  installed["pramana@lambda-brahman"] = {
    version,
    cachePath: cacheDir,
  };

  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  await Bun.write(installedPath, `${JSON.stringify(installed, null, 2)}\n`);

  return ok(undefined);
}

function resolvePort(): string {
  return getFlag("port") ?? process.env.PRAMANA_PORT ?? "5111";
}

async function isServerReachable(port: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`http://localhost:${port}/v1/version`, {
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
      if (!slug) {
        console.error("Missing slug");
        process.exit(1);
      }
      const parts = slug.split("#");
      url = parts.length > 1 ? `${prefix}/get/${parts[0]}/${parts[1]}` : `${prefix}/get/${slug}`;
      break;
    }
    case "search": {
      const query = args[1];
      if (!query) {
        console.error("Missing query");
        process.exit(1);
      }
      url = `${prefix}/search?q=${encodeURIComponent(query)}`;
      break;
    }
    case "traverse": {
      const slug = args[1];
      if (!slug) {
        console.error("Missing slug");
        process.exit(1);
      }
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
      if (!reloadTenant) {
        console.error("Missing --tenant <name>. Specify which tenant to reload.");
        process.exit(1);
      }
      url = `${baseUrl}/v1/${reloadTenant}/reload`;
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

function validateTenantName(name: string): Result<void, CliError> {
  if (!NAME_REGEX.test(name)) {
    return err({
      type: "cli",
      message: `Invalid tenant name "${name}": must match /^[a-z][a-z0-9-]*$/`,
    });
  }
  if (RESERVED_NAMES.has(name)) {
    return err({ type: "cli", message: `Reserved tenant name "${name}"` });
  }
  return ok(undefined);
}

async function handleConfig(): Promise<void> {
  const subcommand = args[1];

  switch (subcommand) {
    case "add": {
      const name = args[2];
      const dir = args[3];
      if (!name || !dir) {
        console.error("Usage: pramana config add <name> <dir>");
        process.exit(1);
      }
      const nameCheck = validateTenantName(name);
      if (!nameCheck.ok) {
        console.error(nameCheck.error.message);
        process.exit(1);
      }
      const absDir = resolve(dir);
      const result = await configAddTenant(name, absDir);
      if (!result.ok) {
        console.error(result.error.message);
        process.exit(1);
      }
      console.log(`Added "${name}" → ${absDir}`);
      break;
    }
    case "remove": {
      const name = args[2];
      if (!name) {
        console.error("Usage: pramana config remove <name>");
        process.exit(1);
      }
      const result = await configRemoveTenant(name);
      if (!result.ok) {
        console.error(result.error.message);
        process.exit(1);
      }
      console.log(`Removed "${name}"`);
      break;
    }
    case "list": {
      const result = await loadConfig();
      if (!result.ok) {
        console.error(result.error.message);
        process.exit(1);
      }
      const entries = Object.entries(result.value.tenants);
      if (entries.length === 0) {
        console.log("No tenants configured");
      } else {
        for (const [name, dir] of entries) {
          console.log(`${name} → ${dir}`);
        }
      }
      break;
    }
    case "path": {
      console.log(configPath());
      break;
    }
    default:
      console.error("Usage: pramana config <add|remove|list|path>");
      process.exit(1);
  }
}

async function main() {
  // Handle --version flag anywhere in args
  if (args.includes("--version")) {
    console.log(`pramana ${VERSION}`);
    process.exit(0);
  }

  // Handle --help flag anywhere in args
  if (args.includes("--help")) {
    usage(0);
  }

  if (!command) usage(0);

  // version command
  if (command === "version") {
    if (hasFlag("check")) {
      const info = await checkLatest();
      if (!info.ok) {
        console.log(`pramana ${VERSION}`);
        console.error(`Could not check for updates: ${info.error.message}`);
      } else if (info.value.upgradeAvailable) {
        console.log(
          `pramana ${info.value.current} (latest: ${info.value.latest}, run \`pramana upgrade\`)`,
        );
        process.exit(1);
      } else {
        console.log(`pramana ${info.value.current} (up to date)`);
      }
    } else {
      console.log(`pramana ${VERSION}`);
    }
    process.exit(0);
  }

  // upgrade command
  if (command === "upgrade") {
    const info = await checkLatest();
    if (!info.ok) {
      console.error(info.error.message);
      process.exit(1);
    }
    if (!info.value.upgradeAvailable) {
      console.log(`pramana ${info.value.current} is already up to date`);
      process.exit(0);
    }
    const targetVersion = info.value.latest;
    console.log(`Upgrading pramana ${info.value.current} → ${targetVersion}...`);
    const upgradeResult = await performUpgrade(targetVersion);
    if (!upgradeResult.ok) {
      console.error(`Upgrade failed: ${upgradeResult.error.message}`);
      process.exit(1);
    }
    console.log(`Upgraded CLI to pramana ${targetVersion}`);

    // Also upgrade plugin
    const pluginResult = await upgradePlugin(targetVersion);
    if (!pluginResult.ok) {
      console.error(
        `Warning: CLI upgraded, but plugin upgrade failed: ${pluginResult.error.message}`,
      );
    } else {
      console.log(`Upgraded plugin to ${targetVersion}`);
    }
    process.exit(0);
  }

  // config command
  if (command === "config") {
    await handleConfig();
    process.exit(0);
  }

  // lint command
  if (command === "lint") {
    const sourceDir = getFlag("source");
    const tenant = getFlag("tenant");
    const strict = hasFlag("strict");

    if (!sourceDir && !tenant) {
      console.error("Missing --source <dir> or --tenant <name>");
      process.exit(1);
    }

    const result = tenant
      ? await (async () => {
          const port = resolvePort();
          const reachable = await isServerReachable(port);
          if (!reachable) {
            console.error("No running daemon found. Use --source <dir> for offline lint.");
            process.exit(1);
          }
          return lintFromDaemon(port, tenant);
        })()
      : await lintSource(resolve(sourceDir!));

    if (!result.ok) {
      console.error(result.error.message);
      process.exit(1);
    }

    const report = result.value;
    console.log(formatDiagnostics(report));

    const hasErrors = strict ? report.errors + report.warnings > 0 : report.errors > 0;
    process.exit(hasErrors ? 1 : 0);
  }

  const standalone = hasFlag("standalone");
  const port = resolvePort();

  // tui — interactive terminal interface
  if (command === "tui") {
    const { createHttpDataSource, createReaderDataSource } = await import("../tui/data-source.ts");
    const { startTui } = await import("../tui/index.tsx");

    // Try daemon first (unless --standalone)
    if (!standalone) {
      const reachable = await isServerReachable(port);
      if (reachable) {
        const ds = createHttpDataSource(port);
        const tenantsResult = await ds.listTenants();
        if (!tenantsResult.ok) {
          console.error(`Could not list tenants: ${tenantsResult.error.message}`);
          process.exit(1);
        }
        const tenants = tenantsResult.value;
        if (tenants.length === 0) {
          console.error("No tenants available on daemon");
          process.exit(1);
        }
        const tenant = getFlag("tenant") ?? tenants[0]!.name;
        await startTui(ds, tenant);
        process.exit(0);
      }
    }

    // Standalone mode: build from sources
    const cliSources = parseSources();
    const configSources: Array<{ path: string; name: string }> = [];
    if (!hasFlag("no-config")) {
      const configResult = await loadConfig();
      if (configResult.ok) {
        for (const [name, dir] of Object.entries(configResult.value.tenants)) {
          configSources.push({ path: dir, name });
        }
      }
    }

    const sourceMap = new Map<string, string>();
    for (const src of configSources) sourceMap.set(src.name, src.path);
    for (const src of cliSources) sourceMap.set(src.name, src.path);

    if (sourceMap.size === 0) {
      console.error("No sources available. Use --source <dir>[:name] or configure tenants.");
      process.exit(1);
    }

    const tm = new TenantManager();
    for (const [name, path] of sourceMap) {
      const nameCheck = validateTenantName(name);
      if (!nameCheck.ok) {
        console.error(`Warning: skipping "${name}": ${nameCheck.error.message}`);
        continue;
      }
      const result = await tm.mount({ name, sourceDir: path });
      if (!result.ok) {
        console.error(`Warning: skipping "${name}": ${result.error.message}`);
        continue;
      }
      const report = result.value;
      console.error(
        `[${name}] Ingested ${report.succeeded}/${report.total} files` +
          (report.failed.length > 0 ? ` (${report.failed.length} failed)` : ""),
      );
    }

    if (tm.tenantNames().length === 0) {
      console.error("No tenants mounted successfully");
      process.exit(1);
    }

    const ds = createReaderDataSource(tm);
    const tenant = getFlag("tenant") ?? tm.tenantNames()[0]!;
    await startTui(ds, tenant);
    tm.close();
    process.exit(0);
  }

  // serve always starts daemon — sources come from config + CLI
  if (command === "serve") {
    const cliSources = parseSources();
    const shouldSave = hasFlag("save");

    // Load config tenants (skip with --no-config)
    const configSources: Array<{ path: string; name: string }> = [];
    if (!hasFlag("no-config")) {
      const configResult = await loadConfig();
      if (!configResult.ok) {
        console.error(`Warning: ${configResult.error.message}. Continuing with CLI sources only.`);
      } else {
        for (const [name, dir] of Object.entries(configResult.value.tenants)) {
          configSources.push({ path: dir, name });
        }
      }
    }

    // Merge: CLI sources override config entries with the same name
    const sourceMap = new Map<string, string>();
    for (const src of configSources) {
      sourceMap.set(src.name, src.path);
    }
    for (const src of cliSources) {
      sourceMap.set(src.name, src.path);
    }

    const tm = new TenantManager();
    const mounted: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const [name, path] of sourceMap) {
      const nameCheck = validateTenantName(name);
      if (!nameCheck.ok) {
        skipped.push({ name, reason: nameCheck.error.message });
        console.error(`Warning: skipping "${name}": ${nameCheck.error.message}`);
        continue;
      }

      const result = await tm.mount({ name, sourceDir: path });
      if (!result.ok) {
        skipped.push({ name, reason: result.error.message });
        console.error(`Warning: skipping "${name}": ${result.error.message}`);
        continue;
      }

      const report = result.value;
      console.error(
        `[${name}] Ingested ${report.succeeded}/${report.total} files` +
          (report.failed.length > 0 ? ` (${report.failed.length} failed)` : ""),
      );
      for (const f of report.failed) {
        console.error(`  ✗ ${f.file}: ${f.error.message}`);
      }
      mounted.push(name);
    }

    if (skipped.length > 0) {
      console.error(
        `\nSkipped ${skipped.length} tenant(s): ${skipped.map((s) => s.name).join(", ")}`,
      );
    }

    // Persist CLI sources to config if --save
    if (shouldSave && cliSources.length > 0) {
      for (const src of cliSources) {
        if (mounted.includes(src.name)) {
          await configAddTenant(src.name, resolve(src.path));
        }
      }
      console.error("Saved CLI sources to config");
    }

    const portNum = Number.parseInt(port, 10);
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

  // Fallback: standalone rebuild using TenantManager
  const sourceDir = getFlag("source");
  if (!sourceDir) {
    console.error("Missing --source <dir> (no running daemon found)");
    process.exit(1);
  }

  const tenantName = getFlag("tenant") ?? basename(sourceDir);

  const tm = new TenantManager();
  const mountResult = await tm.mount({ name: tenantName, sourceDir });
  if (!mountResult.ok) {
    console.error(`Mount failed: ${mountResult.error.message}`);
    process.exit(1);
  }

  const report = mountResult.value;
  console.error(
    `Ingested ${report.succeeded}/${report.total} files` +
      (report.failed.length > 0 ? ` (${report.failed.length} failed)` : ""),
  );
  for (const f of report.failed) {
    console.error(`  ✗ ${f.file}: ${f.error.message}`);
  }

  const readerResult = tm.getReader(tenantName);
  if (!readerResult.ok) {
    console.error(readerResult.error.message);
    process.exit(1);
  }
  const reader = readerResult.value;

  switch (command) {
    case "get": {
      const slug = args[1];
      if (!slug) {
        console.error("Missing slug");
        process.exit(1);
      }
      const result = reader.get(slug);
      if (!result.ok) {
        console.error(result.error.message);
        process.exit(1);
      }
      if (!result.value) {
        console.error("Not found");
        process.exit(1);
      }
      console.log(JSON.stringify(result.value, null, 2));
      tm.close();
      break;
    }

    case "search": {
      const query = args[1];
      if (!query) {
        console.error("Missing query");
        process.exit(1);
      }
      const result = reader.search(query);
      if (!result.ok) {
        console.error(result.error.message);
        process.exit(1);
      }
      console.log(JSON.stringify(result.value, null, 2));
      tm.close();
      break;
    }

    case "traverse": {
      const slug = args[1];
      if (!slug) {
        console.error("Missing slug");
        process.exit(1);
      }
      const relType = getFlag("type");
      const depth = Number.parseInt(getFlag("depth") ?? "1", 10);
      const result = reader.traverse(slug, relType, depth);
      if (!result.ok) {
        console.error(result.error.message);
        process.exit(1);
      }
      console.log(JSON.stringify(result.value, null, 2));
      tm.close();
      break;
    }

    case "list": {
      const tagsStr = getFlag("tags");
      const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : undefined;
      const result = reader.list(tags ? { tags } : undefined);
      if (!result.ok) {
        console.error(result.error.message);
        process.exit(1);
      }
      console.log(JSON.stringify(result.value, null, 2));
      tm.close();
      break;
    }

    default:
      usage();
  }
}

main();
