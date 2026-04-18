import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  checkRuntimeTenantsMatch,
  checkTenantNameValidity,
  checkTenantPaths,
  checkVersionMatch,
  doctorExitCode,
  formatDoctorReport,
  type DoctorReport,
} from "../../../src/cli/doctor.ts";
import { VERSION } from "../../../src/version.ts";

describe("checkVersionMatch", () => {
  test("no diagnostic when versions match", () => {
    const diags = checkVersionMatch(`v${VERSION}`);
    expect(diags).toHaveLength(0);
  });

  test("no diagnostic when versions match without v prefix", () => {
    const diags = checkVersionMatch(VERSION);
    expect(diags).toHaveLength(0);
  });

  test("warn when versions differ", () => {
    const diags = checkVersionMatch("v0.11.0");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("warn");
    expect(diags[0]!.check).toBe("version-match");
    expect(diags[0]!.message).toContain("does not match");
  });
});

describe("checkTenantNameValidity", () => {
  test("no diagnostics for valid names", () => {
    const diags = checkTenantNameValidity(["my-kb", "notes", "law123"]);
    expect(diags).toHaveLength(0);
  });

  test("error for names not matching regex", () => {
    const diags = checkTenantNameValidity(["My-KB", "123bad", "has space"]);
    expect(diags).toHaveLength(3);
    for (const d of diags) {
      expect(d.severity).toBe("error");
      expect(d.check).toBe("tenant-name-validity");
    }
  });

  test("error for reserved names", () => {
    const diags = checkTenantNameValidity(["get", "search", "reload"]);
    expect(diags).toHaveLength(3);
    for (const d of diags) {
      expect(d.severity).toBe("error");
      expect(d.message).toContain("reserved");
    }
  });
});

describe("checkTenantPaths", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("no diagnostics for existing directory", () => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-doctor-"));
    const diags = checkTenantPaths({ "my-kb": tmpDir });
    expect(diags).toHaveLength(0);
  });

  test("error for non-existent path", () => {
    const diags = checkTenantPaths({
      "my-kb": "/tmp/does-not-exist-pramana-test-" + Date.now(),
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[0]!.check).toBe("tenant-config-integrity");
    expect(diags[0]!.message).toContain("does not exist");
  });

  test("error for path that is a file, not a directory", () => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-doctor-"));
    const filePath = path.join(tmpDir, "not-a-dir.txt");
    fs.writeFileSync(filePath, "hello");
    const diags = checkTenantPaths({ "my-kb": filePath });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[0]!.message).toContain("not a directory");
  });
});

describe("checkRuntimeTenantsMatch", () => {
  test("no diagnostics when sets match", () => {
    const diags = checkRuntimeTenantsMatch(["law", "music"], ["law", "music"]);
    expect(diags).toHaveLength(0);
  });

  test("warn for config-only tenants", () => {
    const diags = checkRuntimeTenantsMatch(["law", "music"], ["law"]);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("warn");
    expect(diags[0]!.message).toContain("config but not running");
    expect(diags[0]!.message).toContain("music");
  });

  test("warn for runtime-only tenants", () => {
    const diags = checkRuntimeTenantsMatch(["law"], ["law", "extra"]);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("warn");
    expect(diags[0]!.message).toContain("running but not in config");
    expect(diags[0]!.message).toContain("extra");
  });

  test("both warnings when sets diverge", () => {
    const diags = checkRuntimeTenantsMatch(["law"], ["music"]);
    expect(diags).toHaveLength(2);
  });
});

describe("doctorExitCode", () => {
  test("returns 0 for clean report", () => {
    const report: DoctorReport = { diagnostics: [], summary: { errors: 0, warnings: 0 } };
    expect(doctorExitCode(report)).toBe(0);
  });

  test("returns 1 for warnings only", () => {
    const report: DoctorReport = {
      diagnostics: [{ severity: "warn", check: "test", message: "warn" }],
      summary: { errors: 0, warnings: 1 },
    };
    expect(doctorExitCode(report)).toBe(1);
  });

  test("returns 2 for errors", () => {
    const report: DoctorReport = {
      diagnostics: [{ severity: "error", check: "test", message: "err" }],
      summary: { errors: 1, warnings: 0 },
    };
    expect(doctorExitCode(report)).toBe(2);
  });

  test("returns 2 when both errors and warnings present", () => {
    const report: DoctorReport = {
      diagnostics: [
        { severity: "error", check: "test", message: "err" },
        { severity: "warn", check: "test2", message: "warn" },
      ],
      summary: { errors: 1, warnings: 1 },
    };
    expect(doctorExitCode(report)).toBe(2);
  });
});

describe("formatDoctorReport", () => {
  test("shows all-clear message for clean report", () => {
    const report: DoctorReport = { diagnostics: [], summary: { errors: 0, warnings: 0 } };
    const output = formatDoctorReport(report);
    expect(output).toContain("All checks passed");
    expect(output).toContain("pramana lint --tenant");
  });

  test("groups diagnostics by check", () => {
    const report: DoctorReport = {
      diagnostics: [
        { severity: "error", check: "daemon-reachable", message: "Daemon is not reachable" },
      ],
      summary: { errors: 1, warnings: 0 },
    };
    const output = formatDoctorReport(report);
    expect(output).toContain("daemon-reachable:");
    expect(output).toContain("ERROR");
    expect(output).toContain("Daemon is not reachable");
    expect(output).toContain("1 error(s), 0 warning(s)");
  });

  test("includes lint hint footer", () => {
    const report: DoctorReport = { diagnostics: [], summary: { errors: 0, warnings: 0 } };
    const output = formatDoctorReport(report);
    expect(output).toContain("pramana lint --tenant <name>");
  });
});
