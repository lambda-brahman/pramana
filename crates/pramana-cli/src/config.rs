use crate::error::CliError;
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

pub fn config_dir() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".pramana")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

pub fn load_config() -> Result<Config, CliError> {
    let path = config_path();
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
    let path = config_path();
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
    let mut config = load_config().unwrap_or_default();
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
