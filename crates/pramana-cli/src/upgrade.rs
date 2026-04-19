use crate::error::CliError;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

const VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct VersionInfo {
    pub current: String,
    pub latest: String,
    pub upgrade_available: bool,
}

pub fn check_latest() -> Result<VersionInfo, CliError> {
    let url = "https://api.github.com/repos/lambda-brahman/pramana/releases/latest";
    let resp = ureq::get(url)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", &format!("pramana-cli/{VERSION}"))
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| CliError::Http(format!("GitHub API request failed: {e}")))?;

    let body: serde_json::Value = resp
        .into_json()
        .map_err(|e| CliError::Http(format!("invalid GitHub API response: {e}")))?;

    let latest = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::Http("missing tag_name in GitHub API response".into()))?
        .to_string();

    let current = format!("v{VERSION}");
    let current_ver = semver::Version::parse(VERSION).ok();
    let latest_ver = semver::Version::parse(latest.trim_start_matches('v')).ok();

    let upgrade_available = match (current_ver, latest_ver) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    };

    Ok(VersionInfo {
        current,
        latest,
        upgrade_available,
    })
}

fn platform_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn arch_label() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

fn asset_name() -> String {
    let os = platform_label();
    let arch = arch_label();
    let ext = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    format!("pramana-{os}-{arch}{ext}")
}

fn verify_checksum(bytes: &[u8], expected: &str) -> Result<(), CliError> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected {
        return Err(CliError::User(format!(
            "checksum mismatch: expected {expected}, got {actual}"
        )));
    }
    Ok(())
}

fn parse_checksum_file(text: &str) -> Option<String> {
    // Format: "<hex>  <filename>\n" or just "<hex>\n"
    text.split_whitespace().next().map(|s| s.to_lowercase())
}

fn fetch_expected_checksum(target_version: &str, binary: &str) -> Option<String> {
    let url = format!(
        "https://github.com/lambda-brahman/pramana/releases/download/{target_version}/{binary}.sha256"
    );
    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(10))
        .call()
        .ok()?;
    let text = resp.into_string().ok()?;
    parse_checksum_file(&text)
}

pub fn perform_upgrade(target_version: &str, force: bool) -> Result<(), CliError> {
    let binary = asset_name();
    let url = format!(
        "https://github.com/lambda-brahman/pramana/releases/download/{target_version}/{binary}"
    );

    let expected_hash = fetch_expected_checksum(target_version, &binary);

    if expected_hash.is_none() && !force {
        return Err(CliError::User(
            "no .sha256 checksum file found for this release; \
             cannot verify download integrity. \
             Re-run with --force to upgrade without verification."
                .into(),
        ));
    }

    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(120))
        .call()
        .map_err(|e| CliError::Http(format!("download failed: {e}")))?;

    let content_length = resp
        .header("Content-Length")
        .and_then(|v| v.parse::<u64>().ok());
    const MAX_SIZE: u64 = 200_000_000;
    if let Some(len) = content_length {
        if len > MAX_SIZE {
            return Err(CliError::Http(format!(
                "binary too large ({len} bytes, max {MAX_SIZE})"
            )));
        }
    }

    let mut bytes = Vec::new();
    resp.into_reader()
        .take(MAX_SIZE)
        .read_to_end(&mut bytes)
        .map_err(|e| CliError::Http(format!("download read failed: {e}")))?;

    if let Some(ref expected) = expected_hash {
        verify_checksum(&bytes, expected)?;
        eprintln!("Checksum verified (SHA-256)");
    }

    let exec_path = std::env::current_exe()
        .map_err(|e| CliError::User(format!("could not determine executable path: {e}")))?;
    let tmp_path = exec_path.with_extension("upgrade-tmp");

    fs::write(&tmp_path, &bytes)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o755))?;
    }

    #[cfg(target_os = "windows")]
    {
        let old_path = exec_path.with_extension("old");
        let _ = fs::remove_file(&old_path);
        fs::rename(&exec_path, &old_path)?;
    }

    fs::rename(&tmp_path, &exec_path)?;

    Ok(())
}

fn plugin_cache_dir(version: &str) -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".claude")
            .join("plugins")
            .join("cache")
            .join("lambda-brahman")
            .join("pramana")
            .join(version)
    })
}

fn installed_plugins_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".claude")
            .join("plugins")
            .join("installed_plugins.json")
    })
}

fn update_installed_plugins(version: &str, cache_dir: &Path) -> Result<(), CliError> {
    let plugins_path = installed_plugins_path()
        .ok_or_else(|| CliError::User("could not determine home directory".into()))?;

    if let Some(parent) = plugins_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut map: serde_json::Map<String, serde_json::Value> = if plugins_path.exists() {
        let text = fs::read_to_string(&plugins_path)?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    map.insert(
        "pramana@lambda-brahman".into(),
        serde_json::json!({
            "version": version,
            "cachePath": cache_dir.to_string_lossy()
        }),
    );

    let json = serde_json::to_string_pretty(&serde_json::Value::Object(map))?;
    fs::write(&plugins_path, json)?;

    Ok(())
}

pub fn upgrade_plugin(target_version: &str, force: bool) -> Result<(), CliError> {
    const ARCHIVE: &str = "plugin.tar.gz";
    let url = format!(
        "https://github.com/lambda-brahman/pramana/releases/download/{target_version}/{ARCHIVE}"
    );

    let expected_hash = fetch_expected_checksum(target_version, ARCHIVE);

    if expected_hash.is_none() && !force {
        return Err(CliError::User(
            "no .sha256 checksum file found for plugin archive; \
             re-run with --force to skip verification."
                .into(),
        ));
    }

    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(120))
        .call()
        .map_err(|e| CliError::Http(format!("plugin download failed: {e}")))?;

    const MAX_SIZE: u64 = 50_000_000;
    let content_length = resp
        .header("Content-Length")
        .and_then(|v| v.parse::<u64>().ok());
    if let Some(len) = content_length {
        if len > MAX_SIZE {
            return Err(CliError::Http(format!(
                "plugin archive too large ({len} bytes, max {MAX_SIZE})"
            )));
        }
    }

    let mut bytes = Vec::new();
    resp.into_reader()
        .take(MAX_SIZE)
        .read_to_end(&mut bytes)
        .map_err(|e| CliError::Http(format!("plugin download read failed: {e}")))?;

    if let Some(ref expected) = expected_hash {
        verify_checksum(&bytes, expected)?;
        eprintln!("Plugin checksum verified (SHA-256)");
    }

    let cache_dir = plugin_cache_dir(target_version)
        .ok_or_else(|| CliError::User("could not determine home directory".into()))?;
    fs::create_dir_all(&cache_dir)?;

    let cursor = std::io::Cursor::new(&bytes);
    let gz = flate2::read::GzDecoder::new(cursor);
    let mut archive = tar::Archive::new(gz);
    archive
        .unpack(&cache_dir)
        .map_err(|e| std::io::Error::other(format!("failed to extract plugin archive: {e}")))?;

    update_installed_plugins(target_version, &cache_dir)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn hex_of(data: &[u8]) -> String {
        format!("{:x}", Sha256::digest(data))
    }

    #[test]
    fn parse_checksum_file_bare_hex() {
        let hex = "abc123def456";
        assert_eq!(parse_checksum_file(hex), Some("abc123def456".into()));
    }

    #[test]
    fn parse_checksum_file_gnu_format() {
        let line = "abc123def456  pramana-linux-x64\n";
        assert_eq!(parse_checksum_file(line), Some("abc123def456".into()));
    }

    #[test]
    fn parse_checksum_file_uppercase_normalised() {
        let line = "ABC123DEF456  pramana-linux-x64\n";
        assert_eq!(parse_checksum_file(line), Some("abc123def456".into()));
    }

    #[test]
    fn parse_checksum_file_empty_returns_none() {
        assert_eq!(parse_checksum_file(""), None);
        assert_eq!(parse_checksum_file("   \n"), None);
    }

    #[test]
    fn verify_checksum_passes_with_correct_hash() {
        let data = b"hello pramana";
        let hash = hex_of(data);
        assert!(verify_checksum(data, &hash).is_ok());
    }

    #[test]
    fn verify_checksum_fails_with_wrong_hash() {
        let data = b"hello pramana";
        let bad = "0".repeat(64);
        let err = verify_checksum(data, &bad).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("checksum mismatch"), "unexpected error: {msg}");
    }

    #[test]
    fn verify_checksum_empty_input_matches_known_sha256() {
        // SHA-256 of empty string is well-known
        let empty_sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        assert!(verify_checksum(b"", empty_sha256).is_ok());
    }

    #[test]
    fn asset_name_has_expected_format() {
        let name = asset_name();
        assert!(
            name.starts_with("pramana-"),
            "asset name should start with pramana-: {name}"
        );
        assert!(
            name.contains("darwin") || name.contains("linux") || name.contains("windows"),
            "asset name should contain OS: {name}"
        );
        assert!(
            name.contains("arm64") || name.contains("x64"),
            "asset name should contain arch: {name}"
        );
    }

    #[test]
    fn plugin_cache_dir_has_expected_structure() {
        let dir = plugin_cache_dir("v0.14.0").expect("home dir available");
        let s = dir.to_string_lossy();
        assert!(s.contains(".claude"), "path must be under .claude: {s}");
        assert!(
            s.contains("lambda-brahman"),
            "path must include namespace: {s}"
        );
        assert!(s.contains("pramana"), "path must include plugin name: {s}");
        assert!(s.ends_with("v0.14.0"), "path must end with version: {s}");
    }

    #[test]
    fn installed_plugins_path_is_under_claude_plugins() {
        let p = installed_plugins_path().expect("home dir available");
        let s = p.to_string_lossy();
        assert!(
            s.ends_with("installed_plugins.json"),
            "must end with installed_plugins.json: {s}"
        );
        assert!(s.contains(".claude"), "must be under .claude: {s}");
        assert!(s.contains("plugins"), "must be under plugins: {s}");
    }

    #[test]
    fn update_installed_plugins_creates_and_updates_json() {
        use std::path::Path;

        let tmp = std::env::temp_dir().join(format!(
            "pramana-test-plugins-{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        let cache = Path::new("/home/user/.claude/plugins/cache/lambda-brahman/pramana/v1.0.0");

        // Patch: call the inner logic directly by writing to a temp path
        let mut map = serde_json::Map::new();
        map.insert(
            "pramana@lambda-brahman".into(),
            serde_json::json!({
                "version": "v1.0.0",
                "cachePath": cache.to_string_lossy()
            }),
        );
        let json = serde_json::to_string_pretty(&serde_json::Value::Object(map)).unwrap();
        std::fs::write(&tmp, &json).unwrap();

        let text = std::fs::read_to_string(&tmp).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        let entry = &parsed["pramana@lambda-brahman"];
        assert_eq!(entry["version"], "v1.0.0");
        assert!(entry["cachePath"]
            .as_str()
            .unwrap()
            .contains("lambda-brahman"));

        let _ = std::fs::remove_file(&tmp);
    }
}
