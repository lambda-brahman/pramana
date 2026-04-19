mod config;
mod daemon;
mod doctor;
mod error;
mod init;
mod lint;
mod serve;
mod server;
mod upgrade;

use clap::{Parser, Subcommand};
use config::ConfigAction;
use std::path::PathBuf;
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
        /// Bind address [default: 127.0.0.1, use 0.0.0.0 for LAN access]
        #[arg(long, default_value = "127.0.0.1", env = "PRAMANA_HOST")]
        host: String,
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
        #[arg(value_name = "SLUG", required_unless_present = "slug_flag")]
        slug: Option<String>,
        /// Artifact slug (flag form, for backward compat with TS release)
        #[arg(long = "slug", conflicts_with = "slug", hide = true)]
        slug_flag: Option<String>,
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
        #[arg(value_name = "QUERY", required_unless_present = "query_flag")]
        query: Option<String>,
        /// Search query (flag form, for backward compat with TS release)
        #[arg(long = "query", conflicts_with = "query", hide = true)]
        query_flag: Option<String>,
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
    #[cfg(feature = "mcp")]
    Mcp {
        /// Knowledge source directory, optionally named (repeatable)
        #[arg(long, value_name = "DIR[:NAME]")]
        source: Vec<String>,
    },
    /// Launch interactive terminal interface
    #[cfg(feature = "tui")]
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
    Upgrade {
        /// Skip checksum verification
        #[arg(long)]
        force: bool,
    },
    /// Initialize a new knowledge base directory
    Init {
        /// Directory to initialize
        dir: PathBuf,
    },
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
            host,
            save,
            no_config,
        } => serve::cmd_serve(source, port, &host, save, no_config),
        Commands::Get {
            slug,
            slug_flag,
            tenant,
            port,
        } => {
            let resolved = slug
                .or(slug_flag)
                .expect("clap ensures slug or --slug is present");
            daemon::cmd_daemon_get(port, &tenant, &resolved)
        }
        Commands::Search {
            query,
            query_flag,
            tenant,
            port,
        } => {
            let resolved = query
                .or(query_flag)
                .expect("clap ensures query or --query is present");
            daemon::cmd_daemon_search(port, &tenant, &resolved)
        }
        Commands::Traverse {
            slug,
            tenant,
            r#type,
            depth,
            port,
        } => daemon::cmd_daemon_traverse(port, &tenant, &slug, r#type.as_deref(), depth),
        Commands::List { tenant, tags, port } => {
            daemon::cmd_daemon_list(port, &tenant, tags.as_deref())
        }
        #[cfg(feature = "mcp")]
        Commands::Mcp { source } => cmd_mcp(source),
        #[cfg(feature = "tui")]
        Commands::Tui {
            source,
            port,
            standalone,
            no_config,
            tenant,
        } => cmd_tui(source, port, standalone, no_config, tenant),
        Commands::Doctor { json, port } => cmd_doctor(port, json),
        Commands::Lint {
            source,
            tenant,
            port,
        } => lint::cmd_lint(source, tenant, port),
        Commands::Reload { tenant, port } => daemon::cmd_daemon_reload(port, &tenant),
        Commands::Config { action } => config::cmd_config(action),
        Commands::Version { check } => cmd_version(check),
        Commands::Upgrade { force } => cmd_upgrade(force),
        Commands::Init { dir } => init::cmd_init(&dir),
    }
}

// --- mcp ---

#[cfg(feature = "mcp")]
fn cmd_mcp(sources: Vec<String>) -> i32 {
    use pramana_engine::{TenantConfig, TenantManager};

    if sources.is_empty() {
        eprintln!("At least one --source is required");
        return 1;
    }

    let mut tm = TenantManager::new();
    for raw in &sources {
        let (path, name) = serve::parse_source(raw);
        let cfg = TenantConfig {
            name: name.clone(),
            source_dir: path,
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
            }
            Err(e) => {
                eprintln!("Failed to mount \"{name}\": {e}");
                return 1;
            }
        }
    }

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build();
    let rt = match rt {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to start async runtime: {e}");
            return 1;
        }
    };

    match rt.block_on(pramana_mcp::start_mcp_server(tm)) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("MCP server error: {e}");
            1
        }
    }
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

fn cmd_upgrade(force: bool) -> i32 {
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

    match upgrade::perform_upgrade(&info.latest, force) {
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

// --- tui ---

#[cfg(feature = "tui")]
fn cmd_tui(
    sources: Vec<String>,
    port: u16,
    standalone: bool,
    no_config: bool,
    initial_tenant: Option<String>,
) -> i32 {
    use pramana_engine::{TenantConfig, TenantManager};

    let cli_sources: Vec<(String, String)> =
        sources.iter().map(|s| serve::parse_source(s)).collect();

    let use_daemon = !standalone && pramana_tui::DataSource::check_daemon(port);

    let data_source = if use_daemon {
        pramana_tui::DataSource::Daemon { port }
    } else {
        let mut source_map = std::collections::BTreeMap::new();

        if !no_config {
            if let Ok(cfg) = config::load_config() {
                for (name, dir) in &cfg.tenants {
                    source_map.insert(name.clone(), dir.clone());
                }
            }
        }

        for (path, name) in &cli_sources {
            source_map.insert(name.clone(), path.clone());
        }

        let mut tm = TenantManager::new();
        for (name, path) in &source_map {
            let cfg = TenantConfig {
                name: name.clone(),
                source_dir: path.clone(),
            };
            match tm.mount(cfg) {
                Ok(report) => {
                    eprintln!(
                        "[{name}] Ingested {}/{} files",
                        report.succeeded, report.total
                    );
                }
                Err(e) => {
                    eprintln!("Warning: skipping \"{name}\": {e}");
                }
            }
        }

        pramana_tui::DataSource::Standalone(Box::new(tm))
    };

    let mut app = pramana_tui::App::new(data_source, port, initial_tenant);

    match pramana_tui::run_event_loop(&mut app) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("TUI error: {e}");
            1
        }
    }
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
    fn get_accepts_positional_slug() {
        let cli = Cli::parse_from(["pramana", "get", "--tenant", "kb", "my-slug"]);
        match cli.command.unwrap() {
            Commands::Get {
                slug,
                slug_flag,
                tenant,
                ..
            } => {
                assert_eq!(slug.as_deref(), Some("my-slug"));
                assert!(slug_flag.is_none());
                assert_eq!(tenant, "kb");
            }
            _ => panic!("expected Get"),
        }
    }

    #[test]
    fn get_accepts_flag_slug() {
        let cli = Cli::parse_from(["pramana", "get", "--tenant", "kb", "--slug", "my-slug"]);
        match cli.command.unwrap() {
            Commands::Get {
                slug,
                slug_flag,
                tenant,
                ..
            } => {
                assert!(slug.is_none());
                assert_eq!(slug_flag.as_deref(), Some("my-slug"));
                assert_eq!(tenant, "kb");
            }
            _ => panic!("expected Get"),
        }
    }

    #[test]
    fn search_accepts_positional_query() {
        let cli = Cli::parse_from(["pramana", "search", "--tenant", "kb", "hello world"]);
        match cli.command.unwrap() {
            Commands::Search {
                query,
                query_flag,
                tenant,
                ..
            } => {
                assert_eq!(query.as_deref(), Some("hello world"));
                assert!(query_flag.is_none());
                assert_eq!(tenant, "kb");
            }
            _ => panic!("expected Search"),
        }
    }

    #[test]
    fn search_accepts_flag_query() {
        let cli = Cli::parse_from([
            "pramana",
            "search",
            "--tenant",
            "kb",
            "--query",
            "hello world",
        ]);
        match cli.command.unwrap() {
            Commands::Search {
                query,
                query_flag,
                tenant,
                ..
            } => {
                assert!(query.is_none());
                assert_eq!(query_flag.as_deref(), Some("hello world"));
                assert_eq!(tenant, "kb");
            }
            _ => panic!("expected Search"),
        }
    }
}
