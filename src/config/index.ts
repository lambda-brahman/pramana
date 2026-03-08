import { mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.ts";

const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  tenants: z.record(z.string(), z.string()), // name -> absolute path
});

export type Config = z.infer<typeof ConfigSchema>;

export type ConfigError = { type: "config"; message: string };

const DEFAULT_CONFIG: Config = { version: 1, tenants: {} };

export function configDir(override?: string): string {
  return override ?? join(homedir(), ".pramana");
}

export function configPath(override?: string): string {
  return join(configDir(override), "config.json");
}

export async function loadConfig(pathOverride?: string): Promise<Result<Config, ConfigError>> {
  const p = configPath(pathOverride);
  const file = Bun.file(p);

  if (!(await file.exists())) {
    return ok({ ...DEFAULT_CONFIG, tenants: {} });
  }

  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err({ type: "config", message: `Corrupt config JSON at ${p}` });
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return err({
      type: "config",
      message: `Invalid config at ${p}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    });
  }

  return ok(parsed.data);
}

export async function saveConfig(
  config: Config,
  pathOverride?: string,
): Promise<Result<void, ConfigError>> {
  const p = configPath(pathOverride);
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true });

  const tmpPath = `${p}.tmp`;
  await Bun.write(tmpPath, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmpPath, p);

  return ok(undefined);
}

export async function addTenant(
  name: string,
  sourceDir: string,
  pathOverride?: string,
): Promise<Result<void, ConfigError>> {
  const p = configPath(pathOverride);
  const loadResult = await loadConfig(pathOverride);

  let config: Config;
  if (!loadResult.ok) {
    // Corrupt config — backup and recreate
    const file = Bun.file(p);
    if (await file.exists()) {
      const bakPath = `${p}.bak`;
      renameSync(p, bakPath);
      console.error(`Warning: corrupt config backed up to ${bakPath}`);
    }
    config = { ...DEFAULT_CONFIG, tenants: {} };
  } else {
    config = loadResult.value;
  }

  config.tenants[name] = sourceDir;
  return saveConfig(config, pathOverride);
}

export async function removeTenant(
  name: string,
  pathOverride?: string,
): Promise<Result<void, ConfigError>> {
  const loadResult = await loadConfig(pathOverride);
  if (!loadResult.ok) return loadResult;

  const config = loadResult.value;
  delete config.tenants[name];
  return saveConfig(config, pathOverride);
}
