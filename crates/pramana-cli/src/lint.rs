use crate::daemon::daemon_request;
use pramana_engine::{TenantConfig, TenantManager};

pub fn cmd_lint(source: Option<String>, tenant: Option<String>, port: u16) -> i32 {
    if source.is_none() && tenant.is_none() {
        eprintln!("Missing --source <dir> or --tenant <name>");
        return 1;
    }

    if let Some(ref source_dir) = source {
        return lint_offline(source_dir);
    }

    let tenant = tenant.unwrap();
    let url = format!("http://localhost:{port}/v1/{tenant}/list");
    match daemon_request("GET", &url) {
        Ok(body) => {
            let artifacts: Vec<serde_json::Value> = serde_json::from_str(&body).unwrap_or_default();
            let mut errors = 0usize;
            let slug_set: std::collections::HashSet<String> = artifacts
                .iter()
                .filter_map(|a| {
                    a.get("slug")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string())
                })
                .collect();

            for artifact in &artifacts {
                let slug = artifact
                    .get("slug")
                    .and_then(|s| s.as_str())
                    .unwrap_or("unknown");
                let rels = artifact
                    .get("relationships")
                    .and_then(|r| r.as_array())
                    .cloned()
                    .unwrap_or_default();
                for rel in rels {
                    let target = rel.get("target").and_then(|t| t.as_str()).unwrap_or("");
                    let target_slug = target.split('#').next().unwrap_or(target);
                    if !slug_set.contains(target_slug) {
                        eprintln!("  error  {slug}: dangling link to \"{target_slug}\"");
                        errors += 1;
                    }
                }
            }

            if errors == 0 {
                println!("No issues found ({} artifacts checked)", artifacts.len());
                0
            } else {
                eprintln!("{errors} error(s)");
                1
            }
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

fn lint_offline(source_dir: &str) -> i32 {
    let path = std::path::Path::new(source_dir);
    if !path.is_dir() {
        eprintln!("Source directory does not exist: {source_dir}");
        return 1;
    }

    let mut tm = TenantManager::new();
    let cfg = TenantConfig {
        name: "lint".to_string(),
        source_dir: source_dir.to_string(),
    };

    let report = match tm.mount(cfg) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to ingest sources: {e}");
            return 1;
        }
    };

    let mut errors = 0usize;

    for f in &report.failed {
        eprintln!("  error  {}: {}", f.file, f.error);
        errors += 1;
    }

    for slug in &report.duplicate_slugs {
        eprintln!("  error  duplicate slug: \"{slug}\"");
        errors += 1;
    }

    if let Ok(reader) = tm.reader("lint") {
        if let Ok(all) = reader.list(None) {
            let slug_set: std::collections::HashSet<&str> =
                all.iter().map(|a| a.slug.as_str()).collect();

            for artifact in &all {
                for rel in &artifact.relationships {
                    let target_slug = rel.target.split('#').next().unwrap_or(&rel.target);
                    if !slug_set.contains(target_slug) {
                        eprintln!(
                            "  error  {}: dangling link to \"{target_slug}\"",
                            artifact.slug
                        );
                        errors += 1;
                    }
                }

                if artifact.summary.is_none() {
                    eprintln!("  info   {}: missing summary", artifact.slug);
                }
            }
        }
    }

    if errors == 0 {
        println!(
            "No issues found ({} files, {} succeeded)",
            report.total, report.succeeded
        );
        0
    } else {
        eprintln!("{errors} error(s)");
        1
    }
}
