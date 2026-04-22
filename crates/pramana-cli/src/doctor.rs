use crate::config;
use crate::error::CliError;
use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warn,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorDiagnostic {
    pub severity: Severity,
    pub check: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct DoctorReport {
    pub diagnostics: Vec<DoctorDiagnostic>,
    pub summary: DoctorSummary,
}

#[derive(Debug, Serialize)]
pub struct DoctorSummary {
    pub errors: usize,
    pub warnings: usize,
}

const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn run_doctor(port: u16) -> Result<DoctorReport, CliError> {
    let mut diagnostics = Vec::new();

    let daemon_version = match fetch_daemon_version(port) {
        Ok(v) => Some(v),
        Err(msg) => {
            diagnostics.push(DoctorDiagnostic {
                severity: Severity::Error,
                check: "daemon-reachable".into(),
                message: msg,
            });
            None
        }
    };

    if let Some(ref dv) = daemon_version {
        check_version_match(dv, &mut diagnostics);
    }

    match config::load_config() {
        Ok(cfg) => {
            let config_names: Vec<&str> = cfg.tenants.keys().map(|s| s.as_str()).collect();
            check_tenant_name_validity(&config_names, &mut diagnostics);

            let runtime_names: Option<Vec<String>> = if daemon_version.is_some() {
                match fetch_daemon_tenants(port) {
                    Ok(names) => Some(names),
                    Err(msg) => {
                        diagnostics.push(DoctorDiagnostic {
                            severity: Severity::Error,
                            check: "runtime-tenants-match".into(),
                            message: msg,
                        });
                        None
                    }
                }
            } else {
                None
            };

            check_tenant_paths(&cfg.tenants, runtime_names.as_deref(), &mut diagnostics);

            if let Some(ref names) = runtime_names {
                check_runtime_tenants_match(&config_names, names, &mut diagnostics);
            }
        }
        Err(e) => {
            diagnostics.push(DoctorDiagnostic {
                severity: Severity::Error,
                check: "tenant-config-integrity".into(),
                message: format!("could not load config: {e}"),
            });
        }
    }

    Ok(build_report(diagnostics))
}

fn fetch_daemon_version(port: u16) -> Result<String, String> {
    let url = format!("http://localhost:{port}/v1/version");
    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(2))
        .call()
        .map_err(|_| "Daemon is not reachable".to_string())?;

    let body: serde_json::Value = resp
        .into_json()
        .map_err(|_| "Daemon returned unexpected version payload".to_string())?;

    body.get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Daemon returned unexpected version payload".to_string())
}

fn fetch_daemon_tenants(port: u16) -> Result<Vec<String>, String> {
    let url = format!("http://localhost:{port}/v1/tenants");
    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(2))
        .call()
        .map_err(|e| format!("Failed to fetch tenant list from daemon: {e}"))?;

    let body: serde_json::Value = resp
        .into_json()
        .map_err(|_| "Daemon returned unexpected tenants payload".to_string())?;

    let tenants = body
        .as_array()
        .ok_or_else(|| "Daemon returned unexpected tenants payload".to_string())?;

    Ok(tenants
        .iter()
        .filter_map(|t| {
            t.get("name")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .collect())
}

fn check_version_match(daemon_version: &str, diagnostics: &mut Vec<DoctorDiagnostic>) {
    let cli_ver = semver::Version::parse(VERSION).ok();
    let daemon_ver = semver::Version::parse(daemon_version.trim_start_matches('v')).ok();

    match (cli_ver, daemon_ver) {
        (Some(c), Some(d)) if c != d => {
            diagnostics.push(DoctorDiagnostic {
                severity: Severity::Warn,
                check: "version-match".into(),
                message: format!(
                    "CLI version {VERSION} does not match daemon version {daemon_version}"
                ),
            });
        }
        _ => {}
    }
}

fn is_valid_tenant_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn check_tenant_name_validity(names: &[&str], diagnostics: &mut Vec<DoctorDiagnostic>) {
    let reserved = ["get", "search", "traverse", "list", "tenants", "reload"];

    for name in names {
        if !is_valid_tenant_name(name) {
            diagnostics.push(DoctorDiagnostic {
                severity: Severity::Error,
                check: "tenant-name-validity".into(),
                message: format!("Tenant \"{name}\" does not match /^[a-z][a-z0-9-]*$/"),
            });
        } else if reserved.contains(name) {
            diagnostics.push(DoctorDiagnostic {
                severity: Severity::Error,
                check: "tenant-name-validity".into(),
                message: format!("Tenant \"{name}\" is a reserved name"),
            });
        }
    }
}

fn check_tenant_paths(
    tenants: &std::collections::BTreeMap<String, String>,
    runtime_names: Option<&[String]>,
    diagnostics: &mut Vec<DoctorDiagnostic>,
) {
    let runtime_set: Option<std::collections::HashSet<&str>> =
        runtime_names.map(|names| names.iter().map(|s| s.as_str()).collect());

    for (name, path) in tenants {
        let p = std::path::Path::new(path);
        // Daemon already skipped this tenant gracefully — downgrade to WARN.
        // Without daemon info we can't confirm graceful handling, so keep ERROR.
        let severity = match &runtime_set {
            Some(running) if !running.contains(name.as_str()) => Severity::Warn,
            _ => Severity::Error,
        };
        if !p.exists() {
            diagnostics.push(DoctorDiagnostic {
                severity,
                check: "tenant-config-integrity".into(),
                message: format!("Tenant \"{name}\" source path does not exist: {path}"),
            });
        } else if !p.is_dir() {
            diagnostics.push(DoctorDiagnostic {
                severity,
                check: "tenant-config-integrity".into(),
                message: format!("Tenant \"{name}\" source path is not a directory: {path}"),
            });
        }
    }
}

fn check_runtime_tenants_match(
    config_names: &[&str],
    runtime_names: &[String],
    diagnostics: &mut Vec<DoctorDiagnostic>,
) {
    let config_set: std::collections::HashSet<&str> = config_names.iter().copied().collect();
    let runtime_set: std::collections::HashSet<&str> =
        runtime_names.iter().map(|s| s.as_str()).collect();

    let in_config_only: Vec<&str> = config_names
        .iter()
        .filter(|n| !runtime_set.contains(**n))
        .copied()
        .collect();
    let in_runtime_only: Vec<&str> = runtime_names
        .iter()
        .map(|s| s.as_str())
        .filter(|n| !config_set.contains(n))
        .collect();

    if !in_config_only.is_empty() {
        diagnostics.push(DoctorDiagnostic {
            severity: Severity::Warn,
            check: "runtime-tenants-match".into(),
            message: format!(
                "Tenants in config but not running: {}",
                in_config_only.join(", ")
            ),
        });
    }
    if !in_runtime_only.is_empty() {
        diagnostics.push(DoctorDiagnostic {
            severity: Severity::Warn,
            check: "runtime-tenants-match".into(),
            message: format!(
                "Tenants running but not in config: {}",
                in_runtime_only.join(", ")
            ),
        });
    }
}

fn build_report(diagnostics: Vec<DoctorDiagnostic>) -> DoctorReport {
    let errors = diagnostics
        .iter()
        .filter(|d| matches!(d.severity, Severity::Error))
        .count();
    let warnings = diagnostics
        .iter()
        .filter(|d| matches!(d.severity, Severity::Warn))
        .count();
    DoctorReport {
        diagnostics,
        summary: DoctorSummary { errors, warnings },
    }
}

pub fn format_doctor_report(report: &DoctorReport) -> String {
    let mut lines = Vec::new();
    let red = "\x1b[31m";
    let yellow = "\x1b[33m";
    let green = "\x1b[32m";
    let reset = "\x1b[0m";

    let mut grouped: std::collections::BTreeMap<&str, Vec<&DoctorDiagnostic>> =
        std::collections::BTreeMap::new();
    for d in &report.diagnostics {
        grouped.entry(&d.check).or_default().push(d);
    }

    for (check, diags) in &grouped {
        lines.push(format!("{check}:"));
        for d in diags {
            let (color, label) = if matches!(d.severity, Severity::Error) {
                (red, "ERROR")
            } else {
                (yellow, "WARN")
            };
            lines.push(format!("  {color}{label}{reset}  {}", d.message));
        }
        lines.push(String::new());
    }

    if report.summary.errors == 0 && report.summary.warnings == 0 {
        lines.push(format!("{green}All checks passed{reset}"));
    } else {
        lines.push(format!(
            "{} error(s), {} warning(s)",
            report.summary.errors, report.summary.warnings
        ));
    }

    lines.push(String::new());
    lines.push("For KB integrity checks, run: pramana lint --tenant <name>".into());

    lines.join("\n")
}

pub fn doctor_exit_code(report: &DoctorReport) -> i32 {
    if report.summary.errors > 0 {
        2
    } else if report.summary.warnings > 0 {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_diag(severity: Severity, check: &str, message: &str) -> DoctorDiagnostic {
        DoctorDiagnostic {
            severity,
            check: check.into(),
            message: message.into(),
        }
    }

    #[test]
    fn build_report_counts_errors_and_warnings() {
        let diags = vec![
            make_diag(Severity::Error, "daemon-reachable", "not running"),
            make_diag(Severity::Warn, "version-match", "mismatch"),
            make_diag(Severity::Warn, "runtime-tenants-match", "drift"),
        ];
        let report = build_report(diags);
        assert_eq!(report.summary.errors, 1);
        assert_eq!(report.summary.warnings, 2);
    }

    #[test]
    fn build_report_all_pass() {
        let report = build_report(vec![]);
        assert_eq!(report.summary.errors, 0);
        assert_eq!(report.summary.warnings, 0);
    }

    #[test]
    fn doctor_exit_code_returns_2_for_errors() {
        let report = build_report(vec![make_diag(
            Severity::Error,
            "daemon-reachable",
            "not running",
        )]);
        assert_eq!(doctor_exit_code(&report), 2);
    }

    #[test]
    fn doctor_exit_code_returns_1_for_warnings_only() {
        let report = build_report(vec![make_diag(Severity::Warn, "version-match", "mismatch")]);
        assert_eq!(doctor_exit_code(&report), 1);
    }

    #[test]
    fn doctor_exit_code_returns_0_for_clean() {
        let report = build_report(vec![]);
        assert_eq!(doctor_exit_code(&report), 0);
    }

    #[test]
    fn severity_serialises_as_lowercase() {
        assert_eq!(
            serde_json::to_string(&Severity::Error).unwrap(),
            "\"error\""
        );
        assert_eq!(serde_json::to_string(&Severity::Warn).unwrap(), "\"warn\"");
    }

    #[test]
    fn is_valid_tenant_name_accepts_valid() {
        assert!(is_valid_tenant_name("abc"));
        assert!(is_valid_tenant_name("my-tenant"));
        assert!(is_valid_tenant_name("tenant1"));
    }

    #[test]
    fn is_valid_tenant_name_rejects_invalid() {
        assert!(!is_valid_tenant_name(""));
        assert!(!is_valid_tenant_name("1bad"));
        assert!(!is_valid_tenant_name("Bad"));
        assert!(!is_valid_tenant_name("has space"));
    }

    #[test]
    fn check_tenant_paths_error_when_no_daemon_info() {
        let mut tenants = std::collections::BTreeMap::new();
        tenants.insert("ghost".into(), "/no/such/path/exists/xyz".into());
        let mut diags = Vec::new();
        check_tenant_paths(&tenants, None, &mut diags);
        assert_eq!(diags.len(), 1);
        assert!(matches!(diags[0].severity, Severity::Error));
        assert_eq!(diags[0].check, "tenant-config-integrity");
    }

    #[test]
    fn check_tenant_paths_warn_when_daemon_already_skipped() {
        let mut tenants = std::collections::BTreeMap::new();
        tenants.insert("ghost".into(), "/no/such/path/exists/xyz".into());
        let runtime_names: Vec<String> = vec!["other-tenant".into()];
        let mut diags = Vec::new();
        check_tenant_paths(&tenants, Some(&runtime_names), &mut diags);
        assert_eq!(diags.len(), 1);
        assert!(matches!(diags[0].severity, Severity::Warn));
        assert_eq!(diags[0].check, "tenant-config-integrity");
    }

    #[test]
    fn check_tenant_paths_error_when_bad_path_but_tenant_running() {
        // If a tenant is somehow in the runtime set despite a bad path, keep ERROR.
        let tmp = std::env::temp_dir();
        // Use a file path (exists but not a dir) to trigger the is_dir branch.
        let file_path = tmp.join("pramana_test_not_a_dir.txt");
        std::fs::write(&file_path, b"x").unwrap();
        let path_str = file_path.to_string_lossy().into_owned();
        let mut tenants = std::collections::BTreeMap::new();
        tenants.insert("active".into(), path_str);
        let runtime_names: Vec<String> = vec!["active".into()];
        let mut diags = Vec::new();
        check_tenant_paths(&tenants, Some(&runtime_names), &mut diags);
        let _ = std::fs::remove_file(&file_path);
        assert_eq!(diags.len(), 1);
        assert!(matches!(diags[0].severity, Severity::Error));
    }
}
