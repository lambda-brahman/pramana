use pramana_engine::{ListFilter, TenantManager};
use std::io::Cursor;

pub fn start(host: &str, port: u16, mut tm: TenantManager) -> Result<(), String> {
    let addr = format!("{host}:{port}");
    let server =
        tiny_http::Server::http(&addr).map_err(|e| format!("Failed to bind to {addr}: {e}"))?;

    eprintln!("Pramana serving on http://{addr}");

    loop {
        let request = server.recv().map_err(|e| format!("Server error: {e}"))?;
        handle_request(request, &mut tm);
    }
}

fn handle_request(request: tiny_http::Request, tm: &mut TenantManager) {
    let url = request.url().to_string();
    let method = request.method().clone();

    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    let result = match (method, segments.as_slice()) {
        (tiny_http::Method::Get, ["v1", "version"]) => handle_version(),
        (tiny_http::Method::Get, ["v1", "tenants"]) => handle_tenants(tm),
        (tiny_http::Method::Get, ["v1", tenant, "get", slug]) => handle_get(tm, tenant, slug),
        (tiny_http::Method::Get, ["v1", tenant, "get", slug, section]) => {
            let slug_section = format!("{slug}#{section}");
            handle_get(tm, tenant, &slug_section)
        }
        (tiny_http::Method::Get, ["v1", tenant, "search"]) => handle_search(tm, tenant, query),
        (tiny_http::Method::Get, ["v1", tenant, "traverse", slug]) => {
            handle_traverse(tm, tenant, slug, query)
        }
        (tiny_http::Method::Get, ["v1", tenant, "list"]) => handle_list(tm, tenant, query),
        (tiny_http::Method::Post, ["v1", tenant, "reload"]) => handle_reload(tm, tenant),
        _ => Err((404, "not found".into())),
    };

    match result {
        Ok(json) => respond_json(request, 200, &json),
        Err((status, msg)) => respond_error(request, status, &msg),
    }
}

fn handle_version() -> Result<String, (u16, String)> {
    let version = env!("CARGO_PKG_VERSION");
    Ok(serde_json::json!({ "version": version }).to_string())
}

fn handle_tenants(tm: &TenantManager) -> Result<String, (u16, String)> {
    let tenants = tm.list_tenants();
    serde_json::to_string(&tenants).map_err(|e| (500, e.to_string()))
}

fn handle_get(tm: &TenantManager, tenant: &str, slug: &str) -> Result<String, (u16, String)> {
    let reader = tm.reader(tenant).map_err(|e| (404, e.to_string()))?;
    match reader.get(slug) {
        Ok(Some(view)) => serde_json::to_string(&view).map_err(|e| (500, e.to_string())),
        Ok(None) => Err((404, format!("artifact not found: {slug}"))),
        Err(e) => Err((500, e.to_string())),
    }
}

fn handle_search(
    tm: &TenantManager,
    tenant: &str,
    query_str: &str,
) -> Result<String, (u16, String)> {
    let q = parse_query_param(query_str, "q").unwrap_or_default();
    if q.is_empty() {
        return Err((400, "missing query parameter: q".into()));
    }
    let reader = tm.reader(tenant).map_err(|e| (404, e.to_string()))?;
    let results = reader.search(&q, None).map_err(|e| (500, e.to_string()))?;
    serde_json::to_string(&results).map_err(|e| (500, e.to_string()))
}

fn handle_traverse(
    tm: &TenantManager,
    tenant: &str,
    slug: &str,
    query_str: &str,
) -> Result<String, (u16, String)> {
    let rel_type = parse_query_param(query_str, "type");
    let depth: usize = parse_query_param(query_str, "depth")
        .and_then(|d| d.parse().ok())
        .unwrap_or(1);
    let max_results: Option<usize> =
        parse_query_param(query_str, "max_results").and_then(|v| v.parse().ok());
    let reader = tm.reader(tenant).map_err(|e| (404, e.to_string()))?;
    let results = reader
        .traverse(slug, rel_type.as_deref(), depth, max_results)
        .map_err(|e| (500, e.to_string()))?;
    serde_json::to_string(&results).map_err(|e| (500, e.to_string()))
}

fn handle_list(tm: &TenantManager, tenant: &str, query_str: &str) -> Result<String, (u16, String)> {
    let tags = parse_query_param(query_str, "tags");
    let limit: Option<usize> = parse_query_param(query_str, "limit").and_then(|v| v.parse().ok());
    let offset: Option<usize> = parse_query_param(query_str, "offset").and_then(|v| v.parse().ok());

    let filter = if tags.is_some() || limit.is_some() || offset.is_some() {
        Some(ListFilter {
            tags: tags.map(|t| t.split(',').map(|s| s.trim().to_string()).collect()),
            limit,
            offset,
        })
    } else {
        None
    };
    let reader = tm.reader(tenant).map_err(|e| (404, e.to_string()))?;
    let results = reader
        .list(filter.as_ref())
        .map_err(|e| (500, e.to_string()))?;
    serde_json::to_string(&results).map_err(|e| (500, e.to_string()))
}

fn handle_reload(tm: &mut TenantManager, tenant: &str) -> Result<String, (u16, String)> {
    let report = tm.reload(tenant).map_err(|e| (404, e.to_string()))?;
    serde_json::to_string(&report).map_err(|e| (500, e.to_string()))
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(urldecode(v));
            }
        }
    }
    None
}

fn urldecode(s: &str) -> String {
    let mut bytes = Vec::with_capacity(s.len());
    let mut iter = s.bytes();
    while let Some(b) = iter.next() {
        match b {
            b'%' => {
                let hi = iter.next().and_then(hex_val);
                let lo = iter.next().and_then(hex_val);
                if let (Some(h), Some(l)) = (hi, lo) {
                    bytes.push(h << 4 | l);
                }
            }
            b'+' => bytes.push(b' '),
            _ => bytes.push(b),
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn respond_json(request: tiny_http::Request, status: u16, body: &str) {
    let response = tiny_http::Response::new(
        tiny_http::StatusCode(status),
        vec![tiny_http::Header::from_bytes(b"Content-Type", b"application/json").unwrap()],
        Cursor::new(body.as_bytes().to_vec()),
        Some(body.len()),
        None,
    );
    let _ = request.respond(response);
}

fn respond_error(request: tiny_http::Request, status: u16, message: &str) {
    let body = serde_json::json!({ "error": message }).to_string();
    respond_json(request, status, &body);
}
