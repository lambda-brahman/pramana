import { statSync } from "node:fs";
import { z } from "zod";
import { loadConfig } from "../config/index.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { NAME_REGEX, RESERVED_NAMES } from "../lib/tenant-names.ts";
import { compareSemver, VERSION } from "../version.ts";
import type { Severity } from "./lint.ts";

const DaemonVersionSchema = z.object({ version: z.string() });
const DaemonTenantSchema = z.object({
  name: z.string(),
  sourceDir: z.string(),
  artifactCount: z.number(),
});
const DaemonTenantsSchema = z.array(DaemonTenantSchema);

export type DoctorDiagnostic = {
  severity: Severity;
  check: string;
  message: string;
};

export type DoctorReport = {
  diagnostics: DoctorDiagnostic[];
  summary: { errors: number; warnings: number };
};

export type DoctorError = { type: "doctor"; message: string };

type DaemonTenant = z.infer<typeof DaemonTenantSchema>;

async function fetchDaemonVersion(port: number): Promise<Result<string, DoctorError>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${port}/v1/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok)
      return err({
        type: "doctor",
        message: `Daemon returned HTTP ${res.status}`,
      });
    const parsed = DaemonVersionSchema.safeParse(await res.json());
    if (!parsed.success)
      return err({ type: "doctor", message: "Daemon returned unexpected version payload" });
    return ok(parsed.data.version);
  } catch {
    return err({ type: "doctor", message: "Daemon is not reachable" });
  }
}

async function fetchDaemonTenants(port: number): Promise<Result<DaemonTenant[], DoctorError>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${port}/v1/tenants`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok)
      return err({
        type: "doctor",
        message: `Daemon returned HTTP ${res.status}`,
      });
    const parsed = DaemonTenantsSchema.safeParse(await res.json());
    if (!parsed.success)
      return err({ type: "doctor", message: "Daemon returned unexpected tenants payload" });
    return ok(parsed.data);
  } catch {
    return err({
      type: "doctor",
      message: "Failed to fetch tenant list from daemon",
    });
  }
}

export function checkVersionMatch(daemonVersion: string): DoctorDiagnostic[] {
  if (compareSemver(daemonVersion, VERSION) === 0) return [];
  return [
    {
      severity: "warn",
      check: "version-match",
      message: `CLI version ${VERSION} does not match daemon version ${daemonVersion}`,
    },
  ];
}

export function checkTenantNameValidity(tenantNames: string[]): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  for (const name of tenantNames) {
    if (!NAME_REGEX.test(name)) {
      diagnostics.push({
        severity: "error",
        check: "tenant-name-validity",
        message: `Tenant "${name}" does not match ${NAME_REGEX}`,
      });
    } else if (RESERVED_NAMES.has(name)) {
      diagnostics.push({
        severity: "error",
        check: "tenant-name-validity",
        message: `Tenant "${name}" is a reserved name`,
      });
    }
  }
  return diagnostics;
}

export function checkTenantPaths(tenants: Record<string, string>): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  for (const [name, sourcePath] of Object.entries(tenants)) {
    try {
      const stat = statSync(sourcePath);
      if (!stat.isDirectory()) {
        diagnostics.push({
          severity: "error",
          check: "tenant-config-integrity",
          message: `Tenant "${name}" source path is not a directory: ${sourcePath}`,
        });
      }
    } catch {
      diagnostics.push({
        severity: "error",
        check: "tenant-config-integrity",
        message: `Tenant "${name}" source path does not exist: ${sourcePath}`,
      });
    }
  }
  return diagnostics;
}

export function checkRuntimeTenantsMatch(
  configNames: string[],
  runtimeNames: string[],
): DoctorDiagnostic[] {
  const configSet = new Set(configNames);
  const runtimeSet = new Set(runtimeNames);
  const diagnostics: DoctorDiagnostic[] = [];

  const inConfigOnly = configNames.filter((n) => !runtimeSet.has(n));
  const inRuntimeOnly = runtimeNames.filter((n) => !configSet.has(n));

  if (inConfigOnly.length > 0) {
    diagnostics.push({
      severity: "warn",
      check: "runtime-tenants-match",
      message: `Tenants in config but not running: ${inConfigOnly.join(", ")}`,
    });
  }
  if (inRuntimeOnly.length > 0) {
    diagnostics.push({
      severity: "warn",
      check: "runtime-tenants-match",
      message: `Tenants running but not in config: ${inRuntimeOnly.join(", ")}`,
    });
  }
  return diagnostics;
}

export async function runDoctor(port: number): Promise<Result<DoctorReport, DoctorError>> {
  try {
    return ok(await runDoctorChecks(port));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ type: "doctor", message: `Unexpected error: ${message}` });
  }
}

async function runDoctorChecks(port: number): Promise<DoctorReport> {
  const diagnostics: DoctorDiagnostic[] = [];

  // Check 1: Daemon reachable
  const versionResult = await fetchDaemonVersion(port);
  if (!versionResult.ok) {
    diagnostics.push({
      severity: "error",
      check: "daemon-reachable",
      message: versionResult.error.message,
    });
    return buildReport(diagnostics);
  }

  // Check 2: Version match
  diagnostics.push(...checkVersionMatch(versionResult.value));

  // Check 3+4: Tenant config integrity + name validity
  const configResult = await loadConfig();
  if (configResult.ok) {
    const configTenantNames = Object.keys(configResult.value.tenants);
    diagnostics.push(...checkTenantNameValidity(configTenantNames));
    diagnostics.push(...checkTenantPaths(configResult.value.tenants));

    // Check 5: Runtime tenants match config
    const tenantsResult = await fetchDaemonTenants(port);
    if (tenantsResult.ok) {
      const runtimeNames = tenantsResult.value.map((t) => t.name);
      diagnostics.push(...checkRuntimeTenantsMatch(configTenantNames, runtimeNames));
    } else {
      diagnostics.push({
        severity: "error",
        check: "runtime-tenants-match",
        message: tenantsResult.error.message,
      });
    }
  } else {
    diagnostics.push({
      severity: "error",
      check: "tenant-config-integrity",
      message: `Could not load config: ${configResult.error.message}`,
    });
  }

  return buildReport(diagnostics);
}

function buildReport(diagnostics: DoctorDiagnostic[]): DoctorReport {
  return {
    diagnostics,
    summary: {
      errors: diagnostics.filter((d) => d.severity === "error").length,
      warnings: diagnostics.filter((d) => d.severity === "warn").length,
    },
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  const red = "\x1b[31m";
  const yellow = "\x1b[33m";
  const green = "\x1b[32m";
  const reset = "\x1b[0m";

  const grouped = new Map<string, DoctorDiagnostic[]>();
  for (const d of report.diagnostics) {
    const existing = grouped.get(d.check) ?? [];
    existing.push(d);
    grouped.set(d.check, existing);
  }

  for (const [check, diags] of grouped) {
    lines.push(`${check}:`);
    for (const d of diags) {
      const color = d.severity === "error" ? red : yellow;
      const label = d.severity === "error" ? "ERROR" : "WARN";
      lines.push(`  ${color}${label}${reset}  ${d.message}`);
    }
    lines.push("");
  }

  const { errors, warnings } = report.summary;
  if (errors === 0 && warnings === 0) {
    lines.push(`${green}All checks passed${reset}`);
  } else {
    lines.push(`${errors} error(s), ${warnings} warning(s)`);
  }

  lines.push("");
  lines.push("For KB integrity checks, run: pramana lint --tenant <name>");

  return lines.join("\n");
}

export function doctorExitCode(report: DoctorReport): number {
  if (report.summary.errors > 0) return 2;
  if (report.summary.warnings > 0) return 1;
  return 0;
}
