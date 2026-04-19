use crate::config::validate_tenant_name;

pub fn daemon_request(method: &str, url: &str) -> Result<String, String> {
    let resp = match method {
        "POST" => ureq::post(url)
            .timeout(std::time::Duration::from_secs(30))
            .call(),
        _ => ureq::get(url)
            .timeout(std::time::Duration::from_secs(30))
            .call(),
    };

    match resp {
        Ok(r) => r.into_string().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
            let msg = parsed
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .and_then(|e| e.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| format!("HTTP {code}"));
            Err(msg)
        }
        Err(e) => Err(format!(
            "Pramana daemon not running. Start it with: pramana serve ({e})"
        )),
    }
}

fn urlencoded(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push('%');
                result.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                result.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    result
}

pub fn cmd_daemon_get(port: u16, tenant: &str, slug: &str) -> i32 {
    if let Err(msg) = validate_tenant_name(tenant) {
        eprintln!("{msg}");
        return 1;
    }
    let parts: Vec<&str> = slug.splitn(2, '#').collect();
    let url = if parts.len() > 1 {
        format!(
            "http://localhost:{port}/v1/{tenant}/get/{}/{}",
            parts[0], parts[1]
        )
    } else {
        format!("http://localhost:{port}/v1/{tenant}/get/{slug}")
    };
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

pub fn cmd_daemon_search(port: u16, tenant: &str, query: &str) -> i32 {
    if let Err(msg) = validate_tenant_name(tenant) {
        eprintln!("{msg}");
        return 1;
    }
    let encoded = urlencoded(query);
    let url = format!("http://localhost:{port}/v1/{tenant}/search?q={encoded}");
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

pub fn cmd_daemon_traverse(
    port: u16,
    tenant: &str,
    slug: &str,
    rel_type: Option<&str>,
    depth: usize,
) -> i32 {
    if let Err(msg) = validate_tenant_name(tenant) {
        eprintln!("{msg}");
        return 1;
    }
    let mut params = format!("depth={depth}");
    if let Some(rt) = rel_type {
        params = format!("type={rt}&{params}");
    }
    let url = format!("http://localhost:{port}/v1/{tenant}/traverse/{slug}?{params}");
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

pub fn cmd_daemon_list(port: u16, tenant: &str, tags: Option<&str>) -> i32 {
    if let Err(msg) = validate_tenant_name(tenant) {
        eprintln!("{msg}");
        return 1;
    }
    let url = match tags {
        Some(t) => format!("http://localhost:{port}/v1/{tenant}/list?tags={t}"),
        None => format!("http://localhost:{port}/v1/{tenant}/list"),
    };
    match daemon_request("GET", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

pub fn cmd_daemon_reload(port: u16, tenant: &str) -> i32 {
    if let Err(msg) = validate_tenant_name(tenant) {
        eprintln!("{msg}");
        return 1;
    }
    let url = format!("http://localhost:{port}/v1/{tenant}/reload");
    match daemon_request("POST", &url) {
        Ok(body) => {
            println!("{body}");
            0
        }
        Err(msg) => {
            eprintln!("{msg}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_basic() {
        assert_eq!(urlencoded("hello world"), "hello%20world");
        assert_eq!(urlencoded("a+b"), "a%2Bb");
        assert_eq!(urlencoded("simple"), "simple");
    }

    #[test]
    fn urlencode_unicode_is_percent_encoded_per_byte() {
        // UTF-8 bytes of "café": c3 a9 for é → %C3%A9
        assert!(urlencoded("café").ends_with("%C3%A9"));
    }

    #[test]
    fn validate_tenant_rejects_invalid_in_daemon_get() {
        // Invalid tenant name returns exit code 1 without making a network call.
        assert_eq!(cmd_daemon_get(5111, "INVALID", "slug"), 1);
        assert_eq!(cmd_daemon_get(5111, "", "slug"), 1);
    }

    #[test]
    fn validate_tenant_rejects_invalid_in_daemon_search() {
        assert_eq!(cmd_daemon_search(5111, "INVALID", "q"), 1);
    }

    #[test]
    fn validate_tenant_rejects_invalid_in_daemon_list() {
        assert_eq!(cmd_daemon_list(5111, "INVALID", None), 1);
    }

    #[test]
    fn validate_tenant_rejects_invalid_in_daemon_traverse() {
        assert_eq!(cmd_daemon_traverse(5111, "INVALID", "slug", None, 1), 1);
    }

    #[test]
    fn validate_tenant_rejects_invalid_in_daemon_reload() {
        assert_eq!(cmd_daemon_reload(5111, "INVALID"), 1);
    }
}
