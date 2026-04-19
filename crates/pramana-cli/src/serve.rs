use crate::config;
use pramana_engine::{TenantConfig, TenantManager};
use std::path::Path;

/// Parse a `DIR[:NAME]` source argument into (path, name).
///
/// Skips colons at position 1 when preceded by an ASCII letter (Windows drive letters like
/// `C:\path`), so that `C:\knowledge:kb` correctly yields `("C:\knowledge", "kb")` and bare
/// `C:\knowledge` falls through to the filename heuristic.
pub fn parse_source(s: &str) -> (String, String) {
    let colon_pos = s
        .rfind(':')
        .filter(|&pos| !(pos == 1 && s.as_bytes()[0].is_ascii_alphabetic()));
    if let Some(pos) = colon_pos {
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

pub fn is_local_bind(host: &str) -> bool {
    host == "127.0.0.1" || host == "::1" || host == "localhost"
}

pub fn cmd_serve(sources: Vec<String>, port: u16, host: &str, save: bool, no_config: bool) -> i32 {
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

    if !is_local_bind(host) {
        eprintln!(
            "Warning: binding to {host} — API is accessible from the network without authentication"
        );
    }

    match crate::server::start(host, port, tm) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn source_parsing_windows_drive_letter_is_not_name_separator() {
        // Colon at position 1 after an ASCII letter is a Windows drive letter; must not split.
        let (path, _) = parse_source("C:\\knowledge");
        assert_eq!(path, "C:\\knowledge");
    }

    #[test]
    fn source_parsing_windows_path_with_explicit_name() {
        // The colon beyond position 1 is the name separator even on a Windows-style path.
        let (path, name) = parse_source("C:\\knowledge:kb");
        assert_eq!(path, "C:\\knowledge");
        assert_eq!(name, "kb");
    }

    #[test]
    fn local_bind_recognises_loopback_addresses() {
        assert!(is_local_bind("127.0.0.1"));
        assert!(is_local_bind("::1"));
        assert!(is_local_bind("localhost"));
    }

    #[test]
    fn local_bind_rejects_non_loopback() {
        assert!(!is_local_bind("0.0.0.0"));
        assert!(!is_local_bind("192.168.1.1"));
        assert!(!is_local_bind("0.0.0.1"));
    }
}
