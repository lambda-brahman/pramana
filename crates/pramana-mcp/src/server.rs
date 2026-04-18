use std::sync::Mutex;

use pramana_engine::{ListFilter, TenantManager};
use rmcp::{
    ErrorData as McpError, ServerHandler, ServiceExt,
    model::{
        CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
        PaginatedRequestParams, RawContent, ServerCapabilities, ServerInfo, Tool, object,
    },
    service::{RequestContext, RoleServer},
};
use serde_json::{Value, json};

pub struct PramanaServer {
    manager: Mutex<TenantManager>,
    tools: Vec<Tool>,
}

// Safety: All access to TenantManager goes through the Mutex.
unsafe impl Sync for PramanaServer {}

impl PramanaServer {
    pub fn new(manager: TenantManager) -> Self {
        let tools = build_tool_definitions();
        Self {
            manager: Mutex::new(manager),
            tools,
        }
    }
}

fn build_tool_definitions() -> Vec<Tool> {
    vec![
        Tool::new(
            "list-tenants",
            "List all available knowledge tenants",
            object(json!({
                "type": "object",
                "properties": {}
            })),
        ),
        Tool::new(
            "get",
            "Get a knowledge artifact by slug",
            object(json!({
                "type": "object",
                "properties": {
                    "tenant": { "type": "string", "description": "Tenant name" },
                    "slug": { "type": "string", "description": "Artifact slug" },
                    "section": { "type": "string", "description": "Optional section heading" }
                },
                "required": ["tenant", "slug"]
            })),
        ),
        Tool::new(
            "search",
            "Search knowledge artifacts by query",
            object(json!({
                "type": "object",
                "properties": {
                    "tenant": { "type": "string", "description": "Tenant name" },
                    "query": { "type": "string", "description": "Search query" }
                },
                "required": ["tenant", "query"]
            })),
        ),
        Tool::new(
            "traverse",
            "Traverse relationships from a knowledge artifact",
            object(json!({
                "type": "object",
                "properties": {
                    "tenant": { "type": "string", "description": "Tenant name" },
                    "from": { "type": "string", "description": "Starting artifact slug" },
                    "type": { "type": "string", "description": "Relationship type filter" },
                    "depth": { "type": "number", "description": "Traversal depth (default: 1)" }
                },
                "required": ["tenant", "from"]
            })),
        ),
        Tool::new(
            "list",
            "List knowledge artifacts, optionally filtered by tags",
            object(json!({
                "type": "object",
                "properties": {
                    "tenant": { "type": "string", "description": "Tenant name" },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Filter by tags"
                    }
                },
                "required": ["tenant"]
            })),
        ),
    ]
}

fn success_json<T: serde::Serialize>(data: &T) -> CallToolResult {
    match serde_json::to_string_pretty(data) {
        Ok(text) => CallToolResult::success(vec![Content::new(RawContent::text(text), None)]),
        Err(e) => error_result(&format!("Serialization error: {e}")),
    }
}

fn error_result(message: &str) -> CallToolResult {
    CallToolResult::error(vec![Content::new(RawContent::text(message), None)])
}

fn get_string(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
}

fn require_string(args: &Value, key: &str) -> Result<String, CallToolResult> {
    get_string(args, key)
        .ok_or_else(|| error_result(&format!("Missing required parameter: {key}")))
}

impl PramanaServer {
    fn handle_list_tenants(&self) -> CallToolResult {
        let mgr = self.manager.lock().expect("lock poisoned");
        success_json(&mgr.list_tenants())
    }

    fn handle_get(&self, args: Value) -> CallToolResult {
        let tenant = match require_string(&args, "tenant") {
            Ok(t) => t,
            Err(e) => return e,
        };
        let slug = match require_string(&args, "slug") {
            Ok(s) => s,
            Err(e) => return e,
        };
        let section = get_string(&args, "section");

        let mgr = self.manager.lock().expect("lock poisoned");
        let reader = match mgr.reader(&tenant) {
            Ok(r) => r,
            Err(e) => return error_result(&e.to_string()),
        };

        let slug_with_section = match &section {
            Some(s) => format!("{slug}#{s}"),
            None => slug,
        };

        match reader.get(&slug_with_section) {
            Ok(Some(view)) => success_json(&view),
            Ok(None) => error_result("Not found"),
            Err(e) => error_result(&e.to_string()),
        }
    }

    fn handle_search(&self, args: Value) -> CallToolResult {
        let tenant = match require_string(&args, "tenant") {
            Ok(t) => t,
            Err(e) => return e,
        };
        let query = match require_string(&args, "query") {
            Ok(q) => q,
            Err(e) => return e,
        };

        let mgr = self.manager.lock().expect("lock poisoned");
        let reader = match mgr.reader(&tenant) {
            Ok(r) => r,
            Err(e) => return error_result(&e.to_string()),
        };

        match reader.search(&query, None) {
            Ok(results) => success_json(&results),
            Err(e) => error_result(&e.to_string()),
        }
    }

    fn handle_traverse(&self, args: Value) -> CallToolResult {
        let tenant = match require_string(&args, "tenant") {
            Ok(t) => t,
            Err(e) => return e,
        };
        let from = match require_string(&args, "from") {
            Ok(f) => f,
            Err(e) => return e,
        };
        let rel_type = get_string(&args, "type");
        let depth = args
            .get("depth")
            .and_then(|v| v.as_u64())
            .map(|d| d as usize)
            .unwrap_or(1);

        let mgr = self.manager.lock().expect("lock poisoned");
        let reader = match mgr.reader(&tenant) {
            Ok(r) => r,
            Err(e) => return error_result(&e.to_string()),
        };

        match reader.traverse(&from, rel_type.as_deref(), depth) {
            Ok(results) => success_json(&results),
            Err(e) => error_result(&e.to_string()),
        }
    }

    fn handle_list(&self, args: Value) -> CallToolResult {
        let tenant = match require_string(&args, "tenant") {
            Ok(t) => t,
            Err(e) => return e,
        };

        let mgr = self.manager.lock().expect("lock poisoned");
        let reader = match mgr.reader(&tenant) {
            Ok(r) => r,
            Err(e) => return error_result(&e.to_string()),
        };

        let filter = args.get("tags").and_then(|v| v.as_array()).map(|arr| {
            let tags: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
            ListFilter { tags: Some(tags) }
        });

        match reader.list(filter.as_ref()) {
            Ok(results) => success_json(&results),
            Err(e) => error_result(&e.to_string()),
        }
    }
}

impl PramanaServer {
    pub fn dispatch(&self, tool_name: &str, args: Value) -> CallToolResult {
        match tool_name {
            "list-tenants" => self.handle_list_tenants(),
            "get" => self.handle_get(args),
            "search" => self.handle_search(args),
            "traverse" => self.handle_traverse(args),
            "list" => self.handle_list(args),
            other => error_result(&format!("Unknown tool: {other}")),
        }
    }

    pub fn tool_definitions(&self) -> &[Tool] {
        &self.tools
    }
}

impl ServerHandler for PramanaServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("pramana", env!("CARGO_PKG_VERSION")))
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult::with_all_items(self.tools.clone())))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        let args = request
            .arguments
            .map(Value::Object)
            .unwrap_or(Value::Object(Default::default()));
        let result = self.dispatch(&request.name, args);
        std::future::ready(Ok(result))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.iter().find(|t| t.name == name).cloned()
    }
}

pub async fn start_mcp_server(
    manager: TenantManager,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let server = PramanaServer::new(manager);
    let transport = rmcp::transport::io::stdio();
    let service = server.serve(transport).await?;
    service.waiting().await?;
    Ok(())
}
