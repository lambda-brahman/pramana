use crate::error::CliError;
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

pub fn perform_upgrade(target_version: &str) -> Result<(), CliError> {
    let os = platform_label();
    let arch = arch_label();
    let ext = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let binary = format!("pramana-{os}-{arch}{ext}");
    let url = format!(
        "https://github.com/lambda-brahman/pramana/releases/download/{target_version}/{binary}"
    );

    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(120))
        .call()
        .map_err(|e| CliError::Http(format!("download failed: {e}")))?;

    let exec_path = std::env::current_exe()
        .map_err(|e| CliError::User(format!("could not determine executable path: {e}")))?;
    let tmp_path = exec_path.with_extension("upgrade-tmp");

    let mut bytes = Vec::new();
    resp.into_reader()
        .take(200_000_000) // 200MB limit
        .read_to_end(&mut bytes)
        .map_err(|e| CliError::Http(format!("download read failed: {e}")))?;

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
