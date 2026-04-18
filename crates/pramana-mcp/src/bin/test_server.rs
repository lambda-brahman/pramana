use pramana_engine::{TenantConfig, TenantManager};
use pramana_mcp::start_mcp_server;
use std::path::Path;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures");
    let mut mgr = TenantManager::new();
    let _ = mgr
        .mount(TenantConfig {
            name: "commerce".into(),
            source_dir: fixtures.to_string_lossy().into_owned(),
        })
        .expect("failed to mount fixture tenant");

    start_mcp_server(mgr).await.expect("MCP server failed");
}
