mod config;
mod doctor;
mod error;
mod server;
mod upgrade;

use clap::{Parser, Subcommand};
use pramana_engine::{TenantConfig, TenantManager};
use std::path::{Path, PathBuf};
use std::process;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn parse_port(s: &str) -> Result<u16, String> {
    let port: u16 = s
        .parse()
        .map_err(|_| format!("Invalid port: \"{s}\". Must be a number between 1 and 65535."))?;
    if port == 0 {
        return Err(format!(
            "Invalid port: \"{s}\". Must be a number between 1 and 65535."
        ));
    }
    Ok(port)
}

#[derive(Parser)]
#[command(
    name = "pramana",
    version = VERSION,
    about = "pramana — Knowledge Engine",
    after_help = "Multi-tenant serve:\n  pramana serve --source ./law:law --source ./music:music --port 5111"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the knowledge engine server
    Serve {
        /// Knowledge source directory, optionally named (repeatable)
        #[arg(long, value_name = "DIR[:NAME]")]
        source: Vec<String>,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
        /// Persist CLI sources to config after successful mount
        #[arg(long)]
        save: bool,
        /// Skip loading config file
        #[arg(long)]
        no_config: bool,
    },
    /// Get an artifact by slug
    Get {
        /// Artifact slug (optionally with #section)
        slug: String,
        /// Target tenant name
        #[arg(long)]
        tenant: String,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// Search artifacts by query
    Search {
        /// Search query
        query: String,
        /// Target tenant name
        #[arg(long)]
        tenant: String,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// Traverse artifact relationships
    Traverse {
        /// Starting artifact slug
        slug: String,
        /// Target tenant name
        #[arg(long)]
        tenant: String,
        /// Relationship type filter
        #[arg(long, value_name = "TYPE")]
        r#type: Option<String>,
        /// Traversal depth
        #[arg(long, default_value = "1")]
        depth: usize,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// List artifacts
    List {
        /// Target tenant name
        #[arg(long)]
        tenant: String,
        /// Filter by tags (comma-separated)
        #[arg(long)]
        tags: Option<String>,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// Start MCP stdio server
    Mcp {
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// Launch interactive terminal interface
    Tui {
        /// Knowledge source directories
        #[arg(long, value_name = "DIR[:NAME]")]
        source: Vec<String>,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
        /// Force in-process mode, skip daemon
        #[arg(long)]
        standalone: bool,
        /// Skip loading config file
        #[arg(long)]
        no_config: bool,
        /// Target tenant name
        #[arg(long)]
        tenant: Option<String>,
    },
    /// Run knowledge base integrity diagnostics
    Doctor {
        /// Output JSON format
        #[arg(long)]
        json: bool,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// Lint knowledge sources for errors
    Lint {
        /// Knowledge source directory (offline mode)
        #[arg(long)]
        source: Option<String>,
        /// Target tenant name (daemon mode)
        #[arg(long)]
        tenant: Option<String>,
        /// Treat warnings as errors
        #[arg(long)]
        strict: bool,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// Reload a tenant from disk
    Reload {
        /// Target tenant name
        #[arg(long)]
        tenant: String,
        /// Server port
        #[arg(long, default_value = "5111", env = "PRAMANA_PORT", value_parser = parse_port)]
        port: u16,
    },
    /// Manage pramana configuration
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    /// Show version information
    Version {
        /// Check for available updates
        #[arg(long)]
        check: bool,
    },
    /// Upgrade pramana to the latest version
    Upgrade,
    /// Initialize a new knowledge base directory
    Init {
        /// Directory to initialize
        dir: PathBuf,
    },
}

#[derive(Subcommand)]
enum ConfigAction {
    /// Add a tenant to the config
    Add {
        /// Tenant name
        name: String,
        /// Source directory
        dir: PathBuf,
    },
    /// Remove a tenant from the config
    Remove {
        /// Tenant name
        name: String,
    },
    /// List configured tenants
    List,
    /// Show config file path
    Path,
}

fn main() {
    let cli = Cli::parse();

    let code = match cli.command {
        None => {
            Cli::parse_from(["pramana", "--help"]);
            0
        }
        Some(cmd) => run(cmd),
    };

    process::exit(code);
}

fn run(cmd: Commands) -> i32 {
    match cmd {
        Commands::Serve {
            source,
            port,
            save,
            no_config,
        } => cmd_serve(source, port, save, no_config),
        Commands::Get { slug, tenant, port } => cmd_daemon_get(port, &tenant, &slug),
        Commands::Search {
            query,
            tenant,
            port,
        } => cmd_daemon_search(port, &tenant, &query),
        Commands::Traverse {
            slug,
            tenant,
            r#type,
            depth,
            port,
        } => cmd_daemon_traverse(port, &tenant, &slug, r#type.as_deref(), depth),
        Commands::List { tenant, tags, port } => cmd_daemon_list(port, &tenant, tags.as_deref()),
        Commands::Mcp { port: _ } => {
            eprintln!("MCP server is not yet available in the Rust port. See issue #114.");
            1
        }
        Commands::Tui { .. } => {
            eprintln!("TUI is not yet available in the Rust port. See issue #113.");
            1
        }
        Commands::Doctor { json, port } => cmd_doctor(port, json),
        Commands::Lint {
            source,
            tenant,
            strict,
            port,
        } => cmd_lint(source, tenant, strict, port),
        Commands::Reload { tenant, port } => cmd_daemon_reload(port, &tenant),
        Commands::Config { action } => cmd_config(action),
        Commands::Version { check } => cmd_version(check),
        Commands::Upgrade => cmd_upgrade(),
        Commands::Init { dir } => cmd_init(&dir),
    }
}

// --- serve ---

fn parse_source(s: &str) -> (String, String) {
    if let Some(pos) = s.rfind(':') {
        if pos > 0 {
            let path = &s[..pos];
            let name = &s[pos + 1..];
            if !name.is_empty() {
                return (path.to_string(), name.to_string());
            }
        }
    }
    let name = Path::new(s)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(s)
        .to_string();
    (s.to_string(), name)
}

fn cmd_serve(sources: Vec<String>, port: u16, save: bool, no_config: bool) -> i32 {
    let cli_sources: Vec<(String, String)> = sources.iter().map(|s| parse_source(s)).collect();

    let mut source_map = std::collections::BTreeMap::new();

    if !no_config {
        match config::load_config() {
            Ok(cfg) => {
                for (name, dir) in &cfg.tenants {
                    source_map.insert(name.clone(), dir.clone());
                }
            }
            Err(e) => {
                eprintln!("Warning: {e}. Continuing with CLI sources only.");
            }
        }
    }

    for (path, name) in &cli_sources {
        source_map.insert(name.clone(), path.clone());
    }

    let mut tm = TenantManager::new();
    let mut mounted = Vec::new();
    let mut skipped = Vec::new();

    for (name, path) in &source_map {
        let cfg = TenantConfig {
            name: name.clone(),
            source_dir: path.clone(),
        };
        match tm.mount(cfg) {
            Ok(report) => {
                let failed_msg = if !report.failed.is_empty() {
                    format!(" ({} failed)", report.failed.len())
                } else {
                    String::new()
                };
                eprintln!(
                    "[{name}] Ingested {}/{} files{failed_msg}",
                    report.succeeded, report.total
                );
                for f in &report.failed {
                    eprintln!("  ✗ {}: {}", f.file, f.error);
                }
                mounted.push(name.clone());
            }
            Err(e) => {
                skipped.push(name.clone());
                eprintln!("Warning: skipping \"{name}\": {e}");
            }
        }
    }

    if !skipped.is_empty() {
        eprintln!(
            "\nSkipped {} tenant(s): {}",
            skipped.len(),
            skipped.join(", ")
        );
    }

    if save {
        for (path, name) in &cli_sources {
            if mounted.contains(name) {
                if let Err(e) = config::add_tenant(name, Path::new(path)) {
                    eprintln!("Warning: could not save tenant \"{name}\": {e}");
                }
            }
        }
        eprintln!("Saved CLI sources to config");
    }

    server::start(port, tm);
    0
}

// --- daemon read commands ---

fn daemon_request(method: &str, url: &str) -> Result<String, String> {
    let resp = match method {
        "POST" => ureq::post(url)
            .timeout(std::time::Duration::from_secs(30))
            .call(),
        _ => ureq::get(url)
            .timeout(std::time::Duration::from_secs(30))
            .call(),
    };

    match resp {
        Ok(r) => r.into_string().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
            let msg = parsed
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| format!("HTTP {code}"));
            Err(msg)
        }
        Err(e) => Err(format!("Pramana daemon not running. Start it with: pramana serve ({e})")),
    }
}

fn check_daemon(port: u16) -> bool {
    ureq::get(&format!("http://localhost:{port}/v1/version"))
        .timeout(std::time::Duration::from_secs(1))
        .call()
        .is_ok()
}

fn cmd_daemon_get(port: u16, tenant: &str, slug: &str) -> i32 {
    if !check_daemon(port) {
        eprintln!("Pramana daemon not running. Start it with: pramana serve");
        return 1;
    }
    let parts: Vec<&str> = slug.splitn(2, '#').collect();
    let url = if parts.len() > 1 {
        format!(
            "http://localhost:{port}/v1/{tenant}/get/{}/{}",
            parts[0], parts[1]
        )
    } else {
        format!("http://localhost:{port}/v1/{tenant}/get/{slug}")
    };
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

fn cmd_daemon_search(port: u16, tenant: &str, query: &str) -> i32 {
    if !check_daemon(port) {
        eprintln!("Pramana daemon not running. Start it with: pramana serve");
        return 1;
    }
    let encoded = urlencoded(query);
    let url = format!("http://localhost:{port}/v1/{tenant}/search?q={encoded}");
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

fn cmd_daemon_traverse(
    port: u16,
    tenant: &str,
    slug: &str,
    rel_type: Option<&str>,
    depth: usize,
) -> i32 {
    if !check_daemon(port) {
        eprintln!("Pramana daemon not running. Start it with: pramana serve");
        return 1;
    }
    let mut params = format!("depth={depth}");
    if let Some(rt) = rel_type {
        params = format!("type={rt}&{params}");
    }
    let url = format!("http://localhost:{port}/v1/{tenant}/traverse/{slug}?{params}");
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

fn cmd_daemon_list(port: u16, tenant: &str, tags: Option<&str>) -> i32 {
    if !check_daemon(port) {
        eprintln!("Pramana daemon not running. Start it with: pramana serve");
        return 1;
    }
    let url = match tags {
        Some(t) => format!("http://localhost:{port}/v1/{tenant}/list?tags={t}"),
        None => format!("http://localhost:{port}/v1/{tenant}/list"),
    };
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

fn cmd_daemon_reload(port: u16, tenant: &str) -> i32 {
    if !check_daemon(port) {
        eprintln!("No running daemon found. Reload requires a running daemon.");
        return 1;
    }
    let url = format!("http://localhost:{port}/v1/{tenant}/reload");
    match daemon_request("POST", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

fn urlencoded(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push('%');
                result.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                result.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    result
}

// --- doctor ---

fn cmd_doctor(port: u16, json: bool) -> i32 {
    match doctor::run_doctor(port) {
        Ok(report) => {
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&report).unwrap_or_default()
                );
            } else {
                println!("{}", doctor::format_doctor_report(&report));
            }
            doctor::doctor_exit_code(&report)
        }
        Err(e) => {
            eprintln!("{e}");
            2
        }
    }
}

// --- lint ---

fn cmd_lint(source: Option<String>, tenant: Option<String>, strict: bool, port: u16) -> i32 {
    if source.is_none() && tenant.is_none() {
        eprintln!("Missing --source <dir> or --tenant <name>");
        return 1;
    }

    if let Some(ref source_dir) = source {
        return lint_offline(source_dir, strict);
    }

    let tenant = tenant.unwrap();
    if !check_daemon(port) {
        eprintln!("No running daemon found. Use --source <dir> for offline lint.");
        return 1;
    }

    let url = format!("http://localhost:{port}/v1/{tenant}/list");
    match daemon_request("GET", &url) {
        Ok(body) => {
            let artifacts: Vec<serde_json::Value> =
                serde_json::from_str(&body).unwrap_or_default();
            let mut errors = 0usize;
            let warnings = 0usize;
            let slug_set: std::collections::HashSet<String> = artifacts
                .iter()
                .filter_map(|a| a.get("slug").and_then(|s| s.as_str()).map(|s| s.to_string()))
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
                    let target = rel
                        .get("target")
                        .and_then(|t| t.as_str())
                        .unwrap_or("");
                    let target_slug = target.split('#').next().unwrap_or(target);
                    if !slug_set.contains(target_slug) {
                        eprintln!("  error  {slug}: dangling link to \"{target_slug}\"");
                        errors += 1;
                    }
                }
            }

            if errors == 0 && warnings == 0 {
                println!("No issues found ({} artifacts checked)", artifacts.len());
                0
            } else {
                eprintln!("{errors} error(s), {warnings} warning(s)");
                if errors > 0 || (strict && warnings > 0) {
                    1
                } else {
                    0
                }
            }
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

fn lint_offline(source_dir: &str, strict: bool) -> i32 {
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
    let warnings = 0usize;

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

    if errors == 0 && warnings == 0 {
        println!(
            "No issues found ({} files, {} succeeded)",
            report.total, report.succeeded
        );
        0
    } else {
        eprintln!("{errors} error(s), {warnings} warning(s)");
        if errors > 0 || (strict && warnings > 0) {
            1
        } else {
            0
        }
    }
}

// --- config ---

fn cmd_config(action: ConfigAction) -> i32 {
    match action {
        ConfigAction::Add { name, dir } => {
            if let Err(msg) = validate_tenant_name(&name) {
                eprintln!("{msg}");
                return 1;
            }
            match config::add_tenant(&name, &dir) {
                Ok(()) => {
                    let abs = dir
                        .canonicalize()
                        .unwrap_or_else(|_| dir.clone());
                    println!("Added \"{name}\" → {}", abs.display());
                    0
                }
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            }
        }
        ConfigAction::Remove { name } => match config::remove_tenant(&name) {
            Ok(()) => {
                println!("Removed \"{name}\"");
                0
            }
            Err(e) => {
                eprintln!("{e}");
                1
            }
        },
        ConfigAction::List => match config::load_config() {
            Ok(cfg) => {
                if cfg.tenants.is_empty() {
                    println!("No tenants configured");
                } else {
                    for (name, dir) in &cfg.tenants {
                        println!("{name} → {dir}");
                    }
                }
                0
            }
            Err(e) => {
                eprintln!("{e}");
                1
            }
        },
        ConfigAction::Path => {
            println!("{}", config::config_path().display());
            0
        }
    }
}

fn validate_tenant_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("tenant name cannot be empty".into());
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_lowercase() {
        return Err(format!(
            "Invalid tenant name \"{name}\": must match /^[a-z][a-z0-9-]*$/"
        ));
    }
    for ch in chars {
        if !ch.is_ascii_lowercase() && !ch.is_ascii_digit() && ch != '-' {
            return Err(format!(
                "Invalid tenant name \"{name}\": must match /^[a-z][a-z0-9-]*$/"
            ));
        }
    }
    let reserved = ["get", "search", "traverse", "list", "tenants", "reload"];
    if reserved.contains(&name) {
        return Err(format!("Reserved tenant name \"{name}\""));
    }
    Ok(())
}

// --- version ---

fn cmd_version(check: bool) -> i32 {
    if !check {
        println!("pramana {VERSION}");
        return 0;
    }

    match upgrade::check_latest() {
        Ok(info) => {
            if info.upgrade_available {
                println!(
                    "pramana {VERSION} (latest: {}, run `pramana upgrade`)",
                    info.latest
                );
                1
            } else {
                println!("pramana {VERSION} (up to date)");
                0
            }
        }
        Err(e) => {
            println!("pramana {VERSION}");
            eprintln!("Could not check for updates: {e}");
            0
        }
    }
}

// --- upgrade ---

fn cmd_upgrade() -> i32 {
    let info = match upgrade::check_latest() {
        Ok(i) => i,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };

    if !info.upgrade_available {
        println!("pramana {} is already up to date", info.current);
        return 0;
    }

    eprintln!("Upgrading pramana {} → {}...", info.current, info.latest);

    match upgrade::perform_upgrade(&info.latest) {
        Ok(()) => {
            println!("Upgraded CLI to pramana {}", info.latest);
            0
        }
        Err(e) => {
            eprintln!("Upgrade failed: {e}");
            1
        }
    }
}

// --- init ---

fn cmd_init(dir: &Path) -> i32 {
    if dir.exists() {
        eprintln!("Directory already exists: {}", dir.display());
        return 1;
    }

    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!("Failed to create directory: {e}");
        return 1;
    }

    let sample = dir.join("getting-started.md");
    let content = r#"---
slug: getting-started
title: Getting Started
summary: Introduction to this knowledge base
tags:
  - onboarding
---

# Getting Started

Welcome to your new knowledge base.

## Adding Artifacts

Create `.md` files with YAML frontmatter:

```yaml
---
slug: my-artifact
title: My Artifact
summary: A brief description
tags:
  - example
---
```

## Linking Artifacts

Use wikilinks to connect artifacts: [[getting-started]]
"#;

    if let Err(e) = std::fs::write(&sample, content) {
        eprintln!("Failed to write sample artifact: {e}");
        return 1;
    }

    println!("Initialized knowledge base at {}", dir.display());
    println!("  Created {}", sample.display());
    println!("\nServe it with: pramana serve --source {}", dir.display());
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_validation_rejects_zero() {
        assert!(parse_port("0").is_err());
    }

    #[test]
    fn port_validation_rejects_nan() {
        assert!(parse_port("foo").is_err());
    }

    #[test]
    fn port_validation_rejects_negative() {
        assert!(parse_port("-1").is_err());
    }

    #[test]
    fn port_validation_rejects_out_of_range() {
        assert!(parse_port("65536").is_err());
    }

    #[test]
    fn port_validation_accepts_valid() {
        assert_eq!(parse_port("5111").unwrap(), 5111);
        assert_eq!(parse_port("1").unwrap(), 1);
        assert_eq!(parse_port("65535").unwrap(), 65535);
    }

    #[test]
    fn source_parsing_with_colon() {
        let (path, name) = parse_source("./law:law-kb");
        assert_eq!(path, "./law");
        assert_eq!(name, "law-kb");
    }

    #[test]
    fn source_parsing_without_colon() {
        let (path, name) = parse_source("./law");
        assert_eq!(path, "./law");
        assert_eq!(name, "law");
    }

    #[test]
    fn source_parsing_trailing_colon() {
        let (path, name) = parse_source("./law:");
        assert_eq!(path, "./law:");
        assert_eq!(name, "law:");
    }

    #[test]
    fn tenant_name_valid() {
        assert!(validate_tenant_name("abc").is_ok());
        assert!(validate_tenant_name("my-tenant").is_ok());
        assert!(validate_tenant_name("tenant1").is_ok());
    }

    #[test]
    fn tenant_name_invalid() {
        assert!(validate_tenant_name("").is_err());
        assert!(validate_tenant_name("1bad").is_err());
        assert!(validate_tenant_name("Bad").is_err());
        assert!(validate_tenant_name("has space").is_err());
    }

    #[test]
    fn tenant_name_reserved() {
        assert!(validate_tenant_name("get").is_err());
        assert!(validate_tenant_name("search").is_err());
        assert!(validate_tenant_name("list").is_err());
    }

    #[test]
    fn urlencode_basic() {
        assert_eq!(urlencoded("hello world"), "hello%20world");
        assert_eq!(urlencoded("a+b"), "a%2Bb");
        assert_eq!(urlencoded("simple"), "simple");
    }

    #[test]
    fn init_fails_on_existing_dir() {
        let dir = std::env::temp_dir().join("pramana-test-init-existing");
        std::fs::create_dir_all(&dir).unwrap();
        let code = cmd_init(&dir);
        assert_eq!(code, 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn init_creates_knowledge_base() {
        let dir = std::env::temp_dir().join("pramana-test-init-new");
        let _ = std::fs::remove_dir_all(&dir);
        let code = cmd_init(&dir);
        assert_eq!(code, 0);
        assert!(dir.join("getting-started.md").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
