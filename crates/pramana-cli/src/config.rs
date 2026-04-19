use crate::error::CliError;
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct Config {
    pub version: u32,
    pub tenants: BTreeMap<String, String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            tenants: BTreeMap::new(),
        }
    }
}

#[derive(Subcommand)]
pub enum ConfigAction {
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

pub fn validate_tenant_name(name: &str) -> Result<(), String> {
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
    let reserved = [
        "get", "search", "traverse", "list", "tenants", "reload", "version",
    ];
    if reserved.contains(&name) {
        return Err(format!("Reserved tenant name \"{name}\""));
    }
    Ok(())
}

pub fn cmd_config(action: ConfigAction) -> i32 {
    match action {
        ConfigAction::Add { name, dir } => {
            if let Err(msg) = validate_tenant_name(&name) {
                eprintln!("{msg}");
                return 1;
            }
            match add_tenant(&name, &dir) {
                Ok(()) => {
                    let abs = dir.canonicalize().unwrap_or_else(|_| dir.clone());
                    println!("Added \"{name}\" → {}", abs.display());
                    0
                }
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            }
        }
        ConfigAction::Remove { name } => match remove_tenant(&name) {
            Ok(()) => {
                println!("Removed \"{name}\"");
                0
            }
            Err(e) => {
                eprintln!("{e}");
                1
            }
        },
        ConfigAction::List => match load_config() {
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
        ConfigAction::Path => match config_path() {
            Ok(path) => {
                println!("{}", path.display());
                0
            }
            Err(e) => {
                eprintln!("{e}");
                1
            }
        },
    }
}

pub fn config_dir() -> Result<PathBuf, CliError> {
    dirs::home_dir().map(|h| h.join(".pramana")).ok_or_else(|| {
        CliError::User(
            "could not determine home directory; set $HOME or pass paths explicitly".into(),
        )
    })
}

pub fn config_path() -> Result<PathBuf, CliError> {
    config_dir().map(|d| d.join("config.json"))
}

pub fn load_config() -> Result<Config, CliError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| CliError::User(format!("could not read config at {}: {e}", path.display())))?;
    let config: Config = serde_json::from_str(&text)
        .map_err(|e| CliError::User(format!("corrupt config JSON at {}: {e}", path.display())))?;
    if config.version != 1 {
        return Err(CliError::User(format!(
            "unsupported config version {} at {}",
            config.version,
            path.display()
        )));
    }
    Ok(config)
}

pub fn save_config(config: &Config) -> Result<(), CliError> {
    let path = config_path()?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(config)?;
    fs::write(&tmp, format!("{json}\n"))?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn add_tenant(name: &str, source_dir: &Path) -> Result<(), CliError> {
    let mut config = load_config()?;
    let abs = source_dir
        .canonicalize()
        .unwrap_or_else(|_| source_dir.to_path_buf());
    config
        .tenants
        .insert(name.to_owned(), abs.to_string_lossy().into_owned());
    save_config(&config)
}

pub fn remove_tenant(name: &str) -> Result<(), CliError> {
    let mut config = load_config()?;
    config.tenants.remove(name);
    save_config(&config)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(validate_tenant_name("version").is_err());
    }
}
