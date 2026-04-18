use pramana_engine::{TenantConfig, TenantManager};
use pramana_mcp::PramanaServer;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures")
}

fn setup_server() -> PramanaServer {
    let mut mgr = TenantManager::new();
    let _ = mgr
        .mount(TenantConfig {
            name: "commerce".into(),
            source_dir: fixtures_dir().to_string_lossy().into_owned(),
        })
        .unwrap();
    PramanaServer::new(mgr)
}

fn extract_text(result: &rmcp::model::CallToolResult) -> String {
    result
        .content
        .first()
        .and_then(|c| c.raw.as_text())
        .map(|t| t.text.clone())
        .unwrap_or_default()
}

fn parse_result<T: serde::de::DeserializeOwned>(result: &rmcp::model::CallToolResult) -> T {
    let text = extract_text(result);
    serde_json::from_str(&text).expect("failed to parse result JSON")
}

fn is_success(result: &rmcp::model::CallToolResult) -> bool {
    result.is_error != Some(true)
}

// --- tool definitions ---

#[test]
fn tool_definitions_count() {
    let server = setup_server();
    assert_eq!(server.tool_definitions().len(), 5);
}

#[test]
fn tool_definitions_names() {
    let server = setup_server();
    let names: Vec<&str> = server
        .tool_definitions()
        .iter()
        .map(|t| t.name.as_ref())
        .collect();
    assert!(names.contains(&"list-tenants"));
    assert!(names.contains(&"get"));
    assert!(names.contains(&"search"));
    assert!(names.contains(&"traverse"));
    assert!(names.contains(&"list"));
}

#[test]
fn get_tool_schema_has_required_fields() {
    let server = setup_server();
    let tool = server
        .tool_definitions()
        .iter()
        .find(|t| t.name == "get")
        .unwrap();
    let schema = tool.schema_as_json_value();
    let required = schema["required"].as_array().unwrap();
    assert!(required.contains(&json!("tenant")));
    assert!(required.contains(&json!("slug")));
}

// --- list-tenants ---

#[test]
fn list_tenants_returns_mounted_tenant() {
    let server = setup_server();
    let result = server.dispatch("list-tenants", json!({}));

    assert!(is_success(&result));
    let tenants: Vec<Value> = parse_result(&result);
    assert_eq!(tenants.len(), 1);
    assert_eq!(tenants[0]["name"], "commerce");
}

// --- get ---

#[test]
fn get_returns_artifact_by_slug() {
    let server = setup_server();
    let result = server.dispatch("get", json!({"tenant": "commerce", "slug": "order"}));

    assert!(is_success(&result));
    let data: Value = parse_result(&result);
    assert_eq!(data["slug"], "order");
    assert_eq!(data["title"], "Order");
}

#[test]
fn get_with_section() {
    let server = setup_server();
    let result = server.dispatch(
        "get",
        json!({"tenant": "commerce", "slug": "order", "section": "attributes"}),
    );

    assert!(is_success(&result));
    let data: Value = parse_result(&result);
    assert_eq!(data["slug"], "order");
    assert!(data["focused_section"].is_object());
    assert_eq!(data["focused_section"]["id"], "attributes");
}

#[test]
fn get_nonexistent_returns_error() {
    let server = setup_server();
    let result = server.dispatch(
        "get",
        json!({"tenant": "commerce", "slug": "nonexistent"}),
    );
    assert!(!is_success(&result));
}

#[test]
fn get_missing_tenant_returns_error() {
    let server = setup_server();
    let result = server.dispatch("get", json!({"tenant": "nope", "slug": "order"}));
    assert!(!is_success(&result));
}

#[test]
fn get_missing_slug_returns_error() {
    let server = setup_server();
    let result = server.dispatch("get", json!({"tenant": "commerce"}));
    assert!(!is_success(&result));
    assert!(extract_text(&result).contains("Missing required parameter"));
}

// --- search ---

#[test]
fn search_returns_matching_results() {
    let server = setup_server();
    let result = server.dispatch(
        "search",
        json!({"tenant": "commerce", "query": "purchase"}),
    );

    assert!(is_success(&result));
    let data: Vec<Value> = parse_result(&result);
    assert!(data.iter().any(|r| r["slug"] == "order"));
}

#[test]
fn search_missing_query_returns_error() {
    let server = setup_server();
    let result = server.dispatch("search", json!({"tenant": "commerce"}));
    assert!(!is_success(&result));
}

// --- traverse ---

#[test]
fn traverse_returns_related_artifacts() {
    let server = setup_server();
    let result = server.dispatch(
        "traverse",
        json!({"tenant": "commerce", "from": "order"}),
    );

    assert!(is_success(&result));
    let data: Vec<Value> = parse_result(&result);
    let slugs: Vec<&str> = data.iter().filter_map(|v| v["slug"].as_str()).collect();
    assert!(slugs.contains(&"customer"));
    assert!(slugs.contains(&"line-item"));
}

#[test]
fn traverse_with_type_filter() {
    let server = setup_server();
    let result = server.dispatch(
        "traverse",
        json!({"tenant": "commerce", "from": "customer", "type": "relates-to"}),
    );

    assert!(is_success(&result));
    let data: Vec<Value> = parse_result(&result);
    let slugs: Vec<&str> = data.iter().filter_map(|v| v["slug"].as_str()).collect();
    assert!(slugs.contains(&"order"));
}

#[test]
fn traverse_with_depth_zero_returns_empty() {
    let server = setup_server();
    let result = server.dispatch(
        "traverse",
        json!({"tenant": "commerce", "from": "order", "depth": 0}),
    );

    assert!(is_success(&result));
    let data: Vec<Value> = parse_result(&result);
    assert!(data.is_empty());
}

// --- list ---

#[test]
fn list_returns_all_artifacts() {
    let server = setup_server();
    let result = server.dispatch("list", json!({"tenant": "commerce"}));

    assert!(is_success(&result));
    let data: Vec<Value> = parse_result(&result);
    assert_eq!(data.len(), 4);
}

#[test]
fn list_with_tags_filter() {
    let server = setup_server();
    let result = server.dispatch(
        "list",
        json!({"tenant": "commerce", "tags": ["core"]}),
    );

    assert!(is_success(&result));
    let data: Vec<Value> = parse_result(&result);
    assert!(data.len() >= 2);
    for item in &data {
        let tags: Vec<&str> = item["tags"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert!(tags.contains(&"core"));
    }
}

#[test]
fn list_with_no_matching_tags_returns_empty() {
    let server = setup_server();
    let result = server.dispatch(
        "list",
        json!({"tenant": "commerce", "tags": ["nonexistent-tag"]}),
    );

    assert!(is_success(&result));
    let data: Vec<Value> = parse_result(&result);
    assert!(data.is_empty());
}

// --- unknown tool ---

#[test]
fn unknown_tool_returns_error() {
    let server = setup_server();
    let result = server.dispatch("nonexistent", json!({}));
    assert!(!is_success(&result));
    assert!(extract_text(&result).contains("Unknown tool"));
}

// --- multi-tenant ---

#[test]
fn multi_tenant_isolation() {
    let mut mgr = TenantManager::new();
    let dir = fixtures_dir().to_string_lossy().into_owned();
    let _ = mgr
        .mount(TenantConfig {
            name: "alpha".into(),
            source_dir: dir.clone(),
        })
        .unwrap();
    let _ = mgr
        .mount(TenantConfig {
            name: "beta".into(),
            source_dir: dir,
        })
        .unwrap();

    let server = PramanaServer::new(mgr);

    let result = server.dispatch("list-tenants", json!({}));
    let tenants: Vec<Value> = parse_result(&result);
    assert_eq!(tenants.len(), 2);

    let result_a = server.dispatch("get", json!({"tenant": "alpha", "slug": "order"}));
    assert!(is_success(&result_a));

    let result_b = server.dispatch("get", json!({"tenant": "beta", "slug": "order"}));
    assert!(is_success(&result_b));
}
