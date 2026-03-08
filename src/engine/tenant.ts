import { existsSync } from "node:fs";
import { GraphIndex } from "../graph/index.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { NAME_REGEX, RESERVED_NAMES } from "../lib/tenant-names.ts";
import { SqlitePlugin } from "../storage/sqlite/index.ts";
import { Builder, type BuildReport } from "./builder.ts";
import { Reader } from "./reader.ts";

export type TenantConfig = { name: string; sourceDir: string };

export type TenantState = {
  name: string;
  sourceDir: string;
  storage: SqlitePlugin;
  reader: Reader;
  report: BuildReport;
};

export type TenantError = { type: "tenant"; message: string };

export type TenantInfo = {
  name: string;
  sourceDir: string;
  artifactCount: number;
};

export class TenantManager {
  private tenants = new Map<string, TenantState>();

  async mount(config: TenantConfig): Promise<Result<BuildReport, TenantError>> {
    const { name, sourceDir } = config;

    if (!NAME_REGEX.test(name)) {
      return err({
        type: "tenant",
        message: `Invalid tenant name "${name}": must match /^[a-z][a-z0-9-]*$/`,
      });
    }

    if (RESERVED_NAMES.has(name)) {
      return err({
        type: "tenant",
        message: `Reserved tenant name "${name}"`,
      });
    }

    if (this.tenants.has(name)) {
      return err({
        type: "tenant",
        message: `Tenant "${name}" already mounted`,
      });
    }

    if (!existsSync(sourceDir)) {
      return err({
        type: "tenant",
        message: `Source directory does not exist: ${sourceDir}`,
      });
    }

    const result = await this.buildTenant(sourceDir);
    if (!result.ok) return result;

    const { storage, reader, report } = result.value;
    this.tenants.set(name, { name, sourceDir, storage, reader, report });

    return ok(report);
  }

  async reload(name: string): Promise<Result<BuildReport, TenantError>> {
    const existing = this.tenants.get(name);
    if (!existing) {
      return err({ type: "tenant", message: `Tenant "${name}" not found` });
    }

    const result = await this.buildTenant(existing.sourceDir);
    if (!result.ok) return result;

    const { storage, reader, report } = result.value;

    // Swap atomically — old state was serving until this point
    existing.storage.close();
    this.tenants.set(name, { name, sourceDir: existing.sourceDir, storage, reader, report });

    return ok(report);
  }

  getReader(name: string): Result<Reader, TenantError> {
    const tenant = this.tenants.get(name);
    if (!tenant) {
      return err({ type: "tenant", message: `Tenant "${name}" not found` });
    }
    return ok(tenant.reader);
  }

  tenantNames(): string[] {
    return [...this.tenants.keys()];
  }

  listTenants(): TenantInfo[] {
    const infos: TenantInfo[] = [];
    for (const [, state] of this.tenants) {
      const listResult = state.reader.list();
      const artifactCount = listResult.ok ? listResult.value.length : 0;
      infos.push({
        name: state.name,
        sourceDir: state.sourceDir,
        artifactCount,
      });
    }
    return infos;
  }

  hasTenant(name: string): boolean {
    return this.tenants.has(name);
  }

  close(): void {
    for (const [, state] of this.tenants) {
      state.storage.close();
    }
    this.tenants.clear();
  }

  private async buildTenant(
    sourceDir: string,
  ): Promise<Result<{ storage: SqlitePlugin; reader: Reader; report: BuildReport }, TenantError>> {
    const storage = new SqlitePlugin(":memory:");
    const initResult = storage.initialize();
    if (!initResult.ok) {
      return err({
        type: "tenant",
        message: `Storage init failed: ${initResult.error.message}`,
      });
    }

    const builder = new Builder(storage);
    const buildResult = await builder.build(sourceDir);
    if (!buildResult.ok) {
      storage.close();
      return err({
        type: "tenant",
        message: `Build failed: ${buildResult.error.message}`,
      });
    }

    // Build graph index from all stored artifacts
    const listResult = storage.list();
    const graphIndex = listResult.ok ? GraphIndex.fromArtifacts(listResult.value) : undefined;

    const reader = new Reader(storage, storage, graphIndex);
    return ok({ storage, reader, report: buildResult.value });
  }
}
