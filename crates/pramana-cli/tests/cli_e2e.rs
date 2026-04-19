use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

fn binary() -> String {
    env!("CARGO_BIN_EXE_pramana").to_string()
}

fn fixtures_dir() -> String {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .join("../../test/fixtures")
        .canonicalize()
        .expect("fixtures dir must exist")
        .to_string_lossy()
        .into_owned()
}

fn fixtures_alt_dir() -> String {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .join("../../test/fixtures-alt")
        .canonicalize()
        .expect("fixtures-alt dir must exist")
        .to_string_lossy()
        .into_owned()
}

fn run(args: &[&str]) -> Output {
    Command::new(binary())
        .args(args)
        .env("PRAMANA_PORT", "19999")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("failed to run pramana binary")
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind to port 0")
        .local_addr()
        .expect("local addr")
        .port()
}

struct ServerGuard {
    child: std::process::Child,
}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

// --- version ---

#[test]
fn version_flag_exits_zero_with_version_on_stdout() {
    let out = run(&["--version"]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("pramana"),
        "expected 'pramana' in stdout: {stdout}"
    );
}

#[test]
fn version_subcommand_exits_zero_with_version_on_stdout() {
    let out = run(&["version"]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("pramana"),
        "expected 'pramana' in stdout: {stdout}"
    );
}

// --- help ---

#[test]
fn no_args_shows_help_and_exits_zero() {
    let out = run(&[]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Knowledge Engine"),
        "expected help text: {stdout}"
    );
}

// --- port validation ---

#[test]
fn serve_port_rejects_non_numeric() {
    let source = format!("{}:commerce", fixtures_dir());
    let out = run(&["serve", "--source", &source, "--port", "foo", "--no-config"]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Invalid port"),
        "expected port error: {stderr}"
    );
}

#[test]
fn serve_port_rejects_zero() {
    let source = format!("{}:commerce", fixtures_dir());
    let out = run(&["serve", "--source", &source, "--port", "0", "--no-config"]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Invalid port"),
        "expected port error: {stderr}"
    );
}

#[test]
fn serve_port_rejects_over_65535() {
    let source = format!("{}:commerce", fixtures_dir());
    let out = run(&[
        "serve",
        "--source",
        &source,
        "--port",
        "65536",
        "--no-config",
    ]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Invalid port"),
        "expected port error: {stderr}"
    );
}

#[test]
fn get_rejects_invalid_port() {
    let out = run(&["get", "--tenant", "kb", "slug", "--port", "foo"]);
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn list_rejects_invalid_port() {
    let out = run(&["list", "--tenant", "kb", "--port", "foo"]);
    assert_eq!(out.status.code(), Some(2));
}

// --- lint (offline) ---

#[test]
fn lint_offline_passes_on_clean_sources() {
    let out = run(&["lint", "--source", &fixtures_alt_dir()]);
    assert!(out.status.success(), "lint should pass on clean sources");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("No issues found"),
        "expected success message: {stdout}"
    );
}

#[test]
fn lint_offline_reports_dangling_links() {
    let out = run(&["lint", "--source", &fixtures_dir()]);
    assert_eq!(
        out.status.code(),
        Some(1),
        "lint should fail on dangling links"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("dangling link"),
        "expected dangling link error: {stderr}"
    );
}

#[test]
fn lint_offline_fails_on_nonexistent_dir() {
    let out = run(&["lint", "--source", "/tmp/pramana-e2e-nonexistent"]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("does not exist"),
        "expected error: {stderr}"
    );
}

#[test]
fn lint_requires_source_or_tenant() {
    let out = run(&["lint"]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("--source") || stderr.contains("--tenant"),
        "expected usage hint: {stderr}"
    );
}

// --- doctor ---

#[test]
fn doctor_without_daemon_exits_with_errors() {
    let port = free_port();
    let out = run(&["doctor", "--port", &port.to_string()]);
    assert_eq!(out.status.code(), Some(2), "doctor should exit 2 on errors");
}

#[test]
fn doctor_json_outputs_valid_json_with_expected_fields() {
    let port = free_port();
    let out = run(&["doctor", "--json", "--port", &port.to_string()]);
    assert_eq!(out.status.code(), Some(2));
    let stdout = String::from_utf8_lossy(&out.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).unwrap_or_else(|_| panic!("invalid JSON: {stdout}"));
    assert!(parsed.get("diagnostics").is_some(), "missing diagnostics");
    assert!(parsed.get("summary").is_some(), "missing summary");
}

// --- init ---

#[test]
fn init_creates_knowledge_base_directory() {
    let dir = std::env::temp_dir().join("pramana-e2e-init-create");
    let _ = std::fs::remove_dir_all(&dir);

    let out = run(&["init", dir.to_str().unwrap()]);
    assert!(out.status.success(), "init should succeed");
    assert!(dir.join("getting-started.md").exists());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn init_fails_on_existing_directory() {
    let dir = std::env::temp_dir().join("pramana-e2e-init-existing");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let out = run(&["init", dir.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));

    let _ = std::fs::remove_dir_all(&dir);
}

// --- serve + client commands ---

#[test]
fn serve_get_list_search_against_running_daemon() {
    let port = free_port();
    let source_arg = format!("{}:commerce", fixtures_dir());

    let child = Command::new(binary())
        .args([
            "serve",
            "--source",
            &source_arg,
            "--port",
            &port.to_string(),
            "--no-config",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start server");

    let _guard = ServerGuard { child };

    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    let start = Instant::now();
    let ready = loop {
        if start.elapsed() > Duration::from_secs(10) {
            break false;
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            break true;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    assert!(ready, "server did not become ready within 10s");

    // get: structured JSON on stdout, nothing on stderr
    let get_out = run(&[
        "get",
        "order",
        "--tenant",
        "commerce",
        "--port",
        &port.to_string(),
    ]);
    assert!(get_out.status.success(), "get should succeed");
    let get_stdout = String::from_utf8_lossy(&get_out.stdout);
    let get_json: serde_json::Value = serde_json::from_str(&get_stdout)
        .unwrap_or_else(|_| panic!("get: invalid JSON: {get_stdout}"));
    assert_eq!(get_json["slug"], "order");
    assert!(
        get_out.stderr.is_empty(),
        "get: stderr should be empty for structured output"
    );

    // list: JSON array on stdout
    let list_out = run(&["list", "--tenant", "commerce", "--port", &port.to_string()]);
    assert!(list_out.status.success(), "list should succeed");
    let list_stdout = String::from_utf8_lossy(&list_out.stdout);
    let list_json: Vec<serde_json::Value> = serde_json::from_str(&list_stdout)
        .unwrap_or_else(|_| panic!("list: invalid JSON: {list_stdout}"));
    assert!(
        list_json.len() >= 4,
        "expected at least 4 artifacts, got {}",
        list_json.len()
    );
    assert!(
        list_out.stderr.is_empty(),
        "list: stderr should be empty for structured output"
    );

    // search: JSON array on stdout, results include 'order'
    let search_out = run(&[
        "search",
        "purchase",
        "--tenant",
        "commerce",
        "--port",
        &port.to_string(),
    ]);
    assert!(search_out.status.success(), "search should succeed");
    let search_stdout = String::from_utf8_lossy(&search_out.stdout);
    let search_json: Vec<serde_json::Value> = serde_json::from_str(&search_stdout)
        .unwrap_or_else(|_| panic!("search: invalid JSON: {search_stdout}"));
    assert!(
        search_json.iter().any(|r| r["slug"] == "order"),
        "search for 'purchase' should find 'order'"
    );
}
