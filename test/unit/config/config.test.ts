import { test, expect, describe, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  saveConfig,
  addTenant,
  removeTenant,
  configPath,
} from "../../../src/config/index.ts";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `pramana-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("config", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  test("loadConfig returns default when file does not exist", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ version: 1, tenants: {} });
    }
  });

  test("saveConfig and loadConfig round-trip", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const config = { version: 1 as const, tenants: { law: "/tmp/law", music: "/tmp/music" } };

    const saveResult = await saveConfig(config, dir);
    expect(saveResult.ok).toBe(true);

    const loadResult = await loadConfig(dir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value).toEqual(config);
    }
  });

  test("loadConfig returns error for corrupt JSON", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const p = configPath(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, "not valid json {{{");

    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Corrupt");
    }
  });

  test("addTenant adds and persists tenant", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);

    const result = await addTenant("law", "/tmp/law", dir);
    expect(result.ok).toBe(true);

    const loadResult = await loadConfig(dir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.tenants).toEqual({ law: "/tmp/law" });
    }
  });

  test("addTenant appends to existing tenants", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);

    await addTenant("law", "/tmp/law", dir);
    await addTenant("music", "/tmp/music", dir);

    const loadResult = await loadConfig(dir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.tenants).toEqual({
        law: "/tmp/law",
        music: "/tmp/music",
      });
    }
  });

  test("removeTenant removes tenant", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);

    await addTenant("law", "/tmp/law", dir);
    await addTenant("music", "/tmp/music", dir);

    const result = await removeTenant("law", dir);
    expect(result.ok).toBe(true);

    const loadResult = await loadConfig(dir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.tenants).toEqual({ music: "/tmp/music" });
    }
  });

  test("addTenant recovers from corrupt config with backup", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const p = configPath(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, "corrupt data here");

    const result = await addTenant("law", "/tmp/law", dir);
    expect(result.ok).toBe(true);

    // Backup file should exist
    const bakFile = Bun.file(`${p}.bak`);
    expect(await bakFile.exists()).toBe(true);
    expect(await bakFile.text()).toBe("corrupt data here");

    // New config should be valid
    const loadResult = await loadConfig(dir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.tenants).toEqual({ law: "/tmp/law" });
    }
  });

  test("removeTenant on missing name is a no-op", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);

    await addTenant("law", "/tmp/law", dir);
    const result = await removeTenant("nonexistent", dir);
    expect(result.ok).toBe(true);

    const loadResult = await loadConfig(dir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.tenants).toEqual({ law: "/tmp/law" });
    }
  });
});
