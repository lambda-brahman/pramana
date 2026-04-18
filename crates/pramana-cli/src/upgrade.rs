use crate::error::CliError;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
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

fn fetch_expected_checksum(target_version: &str, binary: &str) -> Option<String> {
    let url = format!(
        "https://github.com/lambda-brahman/pramana/releases/download/{target_version}/{binary}.sha256"
    );
    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(10))
        .call()
        .ok()?;
    let text = resp.into_string().ok()?;
    // Format: "<hex>  <filename>\n" or just "<hex>\n"
    text.split_whitespace().next().map(|s| s.to_lowercase())
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
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if actual != *expected {
            return Err(CliError::User(format!(
                "checksum mismatch: expected {expected}, got {actual}"
            )));
        }
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
