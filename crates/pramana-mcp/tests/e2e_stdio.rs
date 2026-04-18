use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

fn send_rpc(stdin: &mut impl Write, id: u64, method: &str, params: Value) {
    let msg = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });
    writeln!(stdin, "{}", msg).expect("write to stdin");
    stdin.flush().expect("flush stdin");
}

fn send_notification(stdin: &mut impl Write, method: &str, params: Value) {
    let msg = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params
    });
    writeln!(stdin, "{}", msg).expect("write to stdin");
    stdin.flush().expect("flush stdin");
}

fn read_response(reader: &mut BufReader<impl std::io::Read>) -> Value {
    let mut line = String::new();
    reader.read_line(&mut line).expect("read from stdout");
    serde_json::from_str(line.trim()).expect("parse JSON response")
}

fn spawn_server() -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_pramana-mcp-test-server"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn test server")
}

fn initialize(stdin: &mut impl Write, reader: &mut BufReader<impl std::io::Read>) -> Value {
    send_rpc(
        stdin,
        0,
        "initialize",
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "e2e-test", "version": "0.1.0" }
        }),
    );
    let resp = read_response(reader);
    send_notification(stdin, "notifications/initialized", json!({}));
    resp
}

#[test]
fn e2e_initialize_and_list_tools() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());

    let init_resp = initialize(&mut stdin, &mut reader);
    assert_eq!(init_resp["jsonrpc"], "2.0");
    assert_eq!(init_resp["id"], 0);
    assert!(init_resp["result"]["serverInfo"].is_object());

    send_rpc(&mut stdin, 1, "tools/list", json!({}));
    let tools_resp = read_response(&mut reader);
    assert_eq!(tools_resp["id"], 1);
    let tools = tools_resp["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 5);

    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert!(names.contains(&"list-tenants"));
    assert!(names.contains(&"get"));
    assert!(names.contains(&"search"));
    assert!(names.contains(&"traverse"));
    assert!(names.contains(&"list"));

    drop(stdin);
    let _ = child.wait();
}

#[test]
fn e2e_call_list_tenants() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());

    initialize(&mut stdin, &mut reader);

    send_rpc(
        &mut stdin,
        1,
        "tools/call",
        json!({ "name": "list-tenants", "arguments": {} }),
    );
    let resp = read_response(&mut reader);
    assert_eq!(resp["id"], 1);

    let content = &resp["result"]["content"];
    let text = content[0]["text"].as_str().unwrap();
    let tenants: Vec<Value> = serde_json::from_str(text).unwrap();
    assert_eq!(tenants.len(), 1);
    assert_eq!(tenants[0]["name"], "commerce");

    drop(stdin);
    let _ = child.wait();
}

#[test]
fn e2e_call_get() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());

    initialize(&mut stdin, &mut reader);

    send_rpc(
        &mut stdin,
        1,
        "tools/call",
        json!({ "name": "get", "arguments": { "tenant": "commerce", "slug": "order" } }),
    );
    let resp = read_response(&mut reader);
    assert_eq!(resp["id"], 1);
    assert!(resp["result"]["isError"].is_null() || resp["result"]["isError"] == false);

    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let data: Value = serde_json::from_str(text).unwrap();
    assert_eq!(data["slug"], "order");
    assert_eq!(data["title"], "Order");

    drop(stdin);
    let _ = child.wait();
}

#[test]
fn e2e_call_search() {
    let mut child = spawn_server();
    let mut stdin = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());

    initialize(&mut stdin, &mut reader);

    send_rpc(
        &mut stdin,
        1,
        "tools/call",
        json!({ "name": "search", "arguments": { "tenant": "commerce", "query": "purchase" } }),
    );
    let resp = read_response(&mut reader);
    assert_eq!(resp["id"], 1);

    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let results: Vec<Value> = serde_json::from_str(text).unwrap();
    assert!(results.iter().any(|r| r["slug"] == "order"));

    drop(stdin);
    let _ = child.wait();
}
