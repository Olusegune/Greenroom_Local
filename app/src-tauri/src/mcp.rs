//! A Model Context Protocol (MCP) server so other AI agents (Claude Desktop, scripts, automations) can drive Greenroom: hand it a script
//! or a brief and have the app plan and run the production. It is an HTTP JSON-RPC endpoint (`POST /mcp`, protocol "Streamable HTTP",
//! JSON replies only) and it is OFF until the owner turns it on in Settings.
//!
//! Safety, enforced here and tested:
//!   * binds 127.0.0.1 only, so nothing outside this PC can connect;
//!   * every request needs the bearer token the owner copied from Settings (compared in constant time);
//!   * the Host header must be this machine and an Origin header, when present, must be this machine (stops a web page from
//!     reaching it, including by DNS rebinding);
//!   * strict limits: header and body size, read time, one tool at a time;
//!   * tool arguments are checked against the schema in `app/src/mcp/tools.json` before anything runs;
//!   * there is NO tool that approves a voice, spends money or delivers a final export. Those stay with the person in the app
//!     window: paid work shows the app's own cost sheet and the call waits for the person's answer.
//!
//! The tools themselves run in the app window (they use the same code as the screens); this file only receives, checks and relays.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The tools and their argument schemas. One source for this server and for the app window's handlers.
pub const TOOLS_JSON: &str = include_str!("../../src/mcp/tools.json");
pub const DEFAULT_PORT: u16 = 47821;
const MAX_HEADERS: usize = 16 * 1024;
const MAX_BODY: usize = 1 << 20;
const READ_TIMEOUT: Duration = Duration::from_secs(10);
const SUPPORTED: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// Relays a tool call to wherever the tools run and waits for the answer.
pub trait Bridge: Send + Sync {
    fn call(&self, name: &str, args: Value, timeout: Duration) -> Result<Value, String>;
}

pub struct Server {
    stop: Arc<AtomicBool>,
    pub port: u16,
}

impl Server {
    pub fn start(port: u16, token: String, bridge: Arc<dyn Bridge>) -> Result<Server, String> {
        if token.len() < 24 {
            return Err("The access token is too short.".into());
        }
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|_| format!("Port {port} is already in use. Choose another port in Settings."))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop2 = stop.clone();
        let gate = Arc::new(Mutex::new(()));
        std::thread::spawn(move || {
            while !stop2.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let (token, bridge, gate) = (token.clone(), bridge.clone(), gate.clone());
                        std::thread::spawn(move || handle(stream, port, &token, bridge.as_ref(), &gate));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(40)),
                    Err(_) => std::thread::sleep(Duration::from_millis(200)),
                }
            }
        });
        Ok(Server { stop, port })
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Equal strings take the same time to compare, whatever the first difference is.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

fn read_request(stream: &mut TcpStream) -> Result<Request, (u16, &'static str)> {
    stream.set_read_timeout(Some(READ_TIMEOUT)).ok();
    let started = Instant::now();
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEADERS {
            return Err((431, "Request headers too large"));
        }
        if started.elapsed() > READ_TIMEOUT {
            return Err((408, "Request timed out"));
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err((400, "Connection closed")),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => return Err((408, "Request timed out")),
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let (method, path) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
    let headers: Vec<(String, String)> = lines.filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))).collect();
    let len = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-length")).and_then(|(_, v)| v.parse::<usize>().ok()).unwrap_or(0);
    if headers.iter().any(|(k, v)| k.eq_ignore_ascii_case("transfer-encoding") && !v.is_empty()) {
        return Err((400, "Chunked requests are not supported"));
    }
    if len > MAX_BODY {
        return Err((413, "Request too large"));
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        if started.elapsed() > READ_TIMEOUT {
            return Err((408, "Request timed out"));
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err((400, "Connection closed")),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
            Err(_) => return Err((408, "Request timed out")),
        }
    }
    body.truncate(len);
    Ok(Request { method, path, headers, body })
}

fn respond(stream: &mut TcpStream, status: u16, reason: &str, body: &str, extra: &[(&str, &str)]) {
    let mut out = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n", body.len());
    for (k, v) in extra {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    out.push_str(body);
    let _ = stream.write_all(out.as_bytes());
}

fn local_host(h: &str, port: u16) -> bool {
    let h = h.trim().to_ascii_lowercase();
    [format!("127.0.0.1:{port}"), format!("localhost:{port}"), format!("[::1]:{port}"), "127.0.0.1".into(), "localhost".into()].contains(&h)
}

fn local_origin(o: &str) -> bool {
    let rest = o.trim().to_ascii_lowercase();
    let rest = rest.strip_prefix("http://").or_else(|| rest.strip_prefix("https://")).unwrap_or("");
    let host = rest.split('/').next().unwrap_or("");
    let name = if let Some(stripped) = host.strip_prefix('[') { stripped.split(']').next().unwrap_or("") } else { host.split(':').next().unwrap_or("") };
    matches!(name, "127.0.0.1" | "localhost" | "::1")
}

fn handle(mut stream: TcpStream, port: u16, token: &str, bridge: &dyn Bridge, gate: &Mutex<()>) {
    let req = match read_request(&mut stream) {
        Ok(r) => r,
        Err((code, msg)) => return respond(&mut stream, code, msg, &json!({ "error": msg }).to_string(), &[]),
    };
    // where it came from
    if !req.header("host").map(|h| local_host(h, port)).unwrap_or(false) {
        return respond(&mut stream, 403, "Forbidden", &json!({ "error": "Not a local request." }).to_string(), &[]);
    }
    if let Some(o) = req.header("origin") {
        if !local_origin(o) {
            return respond(&mut stream, 403, "Forbidden", &json!({ "error": "A web page may not use this endpoint." }).to_string(), &[]);
        }
    }
    // who is asking
    let given = req.header("authorization").and_then(|a| a.strip_prefix("Bearer ")).unwrap_or("");
    if !same(given, token) {
        return respond(&mut stream, 401, "Unauthorized", &json!({ "error": "Missing or wrong access token." }).to_string(), &[("WWW-Authenticate", "Bearer")]);
    }
    if req.path.split('?').next() != Some("/mcp") {
        return respond(&mut stream, 404, "Not Found", &json!({ "error": "Use /mcp." }).to_string(), &[]);
    }
    if req.method != "POST" {
        return respond(&mut stream, 405, "Method Not Allowed", &json!({ "error": "Use POST." }).to_string(), &[("Allow", "POST")]);
    }
    let Ok(msg) = serde_json::from_slice::<Value>(&req.body) else {
        return respond(&mut stream, 400, "Bad Request", &rpc_error(Value::Null, -32700, "Parse error").to_string(), &[]);
    };
    let reply = match &msg {
        Value::Array(items) => {
            let out: Vec<Value> = items.iter().filter_map(|m| dispatch(m, bridge, gate)).collect();
            if out.is_empty() { None } else { Some(Value::Array(out)) }
        }
        one => dispatch(one, bridge, gate),
    };
    match reply {
        Some(v) => respond(&mut stream, 200, "OK", &v.to_string(), &[]),
        None => respond(&mut stream, 202, "Accepted", "", &[]),
    }
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn rpc_ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn tools() -> Vec<Value> {
    serde_json::from_str::<Vec<Value>>(TOOLS_JSON).unwrap_or_default()
}

/// How long a tool may take before the caller is told it is still waiting on the person: running a production can take a while.
fn timeout_for(name: &str) -> Duration {
    match name {
        "run_production" => Duration::from_secs(30 * 60),
        _ => Duration::from_secs(90),
    }
}

/// Checks tool arguments against the small subset of JSON Schema that tools.json uses.
pub fn validate(schema: &Value, args: &Value) -> Result<(), String> {
    let obj = args.as_object().ok_or("Arguments must be an object.")?;
    let props = schema["properties"].as_object().cloned().unwrap_or_default();
    for key in schema["required"].as_array().into_iter().flatten().filter_map(|k| k.as_str()) {
        if !obj.contains_key(key) {
            return Err(format!("Missing argument: {key}."));
        }
    }
    for (k, v) in obj {
        let Some(p) = props.get(k) else { return Err(format!("Unknown argument: {k}.")) };
        match p["type"].as_str().unwrap_or("") {
            "string" => {
                let s = v.as_str().ok_or_else(|| format!("{k} must be text."))?;
                if let Some(max) = p["maxLength"].as_u64() {
                    if s.chars().count() as u64 > max {
                        return Err(format!("{k} is too long (at most {max} characters)."));
                    }
                }
                if let Some(allowed) = p["enum"].as_array() {
                    if !allowed.iter().any(|a| a.as_str() == Some(s)) {
                        return Err(format!("{k} must be one of: {}.", allowed.iter().filter_map(|a| a.as_str()).collect::<Vec<_>>().join(", ")));
                    }
                }
            }
            "boolean" => {
                v.as_bool().ok_or_else(|| format!("{k} must be true or false."))?;
            }
            "number" => {
                let n = v.as_f64().ok_or_else(|| format!("{k} must be a number."))?;
                if p["minimum"].as_f64().map(|m| n < m).unwrap_or(false) || p["maximum"].as_f64().map(|m| n > m).unwrap_or(false) {
                    return Err(format!("{k} is out of range."));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn dispatch(msg: &Value, bridge: &dyn Bridge, gate: &Mutex<()>) -> Option<Value> {
    let id = msg.get("id").cloned();
    let Some(method) = msg.get("method").and_then(|m| m.as_str()) else {
        return id.map(|i| rpc_error(i, -32600, "Invalid request"));
    };
    // a notification has no id and gets no answer
    let id = id?;
    Some(match method {
        "initialize" => {
            let asked = msg["params"]["protocolVersion"].as_str().unwrap_or("");
            let version = if SUPPORTED.contains(&asked) { asked } else { SUPPORTED[0] };
            rpc_ok(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "greenroom-local", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Greenroom Local makes lifelike voice performances. Call greenroom_status first. You can create a project from a script, plan a production from a brief and run it. Voice approval, spending and the final delivery are decided by the person in the Greenroom window; you cannot approve them. Greenroom has not judged how anything sounds: only the owner's own listening verdicts say that."
                }),
            )
        }
        "ping" => rpc_ok(id, json!({})),
        "tools/list" => rpc_ok(id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            let all = tools();
            let Some(tool) = all.iter().find(|t| t["name"].as_str() == Some(name)) else {
                return Some(rpc_error(id, -32602, &format!("Unknown tool: {name}")));
            };
            let args = msg["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            if let Err(e) = validate(&tool["inputSchema"], &args) {
                return Some(rpc_error(id, -32602, &e));
            }
            // one tool at a time: they act on the one open project in the window
            let _one = gate.lock().unwrap_or_else(|p| p.into_inner());
            match bridge.call(name, args, timeout_for(name)) {
                Ok(v) => rpc_ok(id, json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }], "isError": false })),
                Err(e) => rpc_ok(id, json!({ "content": [{ "type": "text", "text": e }], "isError": true })),
            }
        }
        _ => rpc_error(id, -32601, "Method not found"),
    })
}

/// A random access token, 48 hex characters, from the operating system.
pub fn new_token() -> Result<String, String> {
    let mut b = [0u8; 24];
    getrandom::getrandom(&mut b).map_err(|e| format!("Could not make a random token: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(Mutex<Vec<(String, Value)>>);
    impl Bridge for Fake {
        fn call(&self, name: &str, args: Value, _t: Duration) -> Result<Value, String> {
            self.0.lock().unwrap().push((name.to_string(), args.clone()));
            if name == "open_project" && args["id"] == "missing" {
                return Err("Could not open that project.".into());
            }
            Ok(json!({ "tool": name, "args": args }))
        }
    }

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

    fn start() -> (Server, Arc<Fake>) {
        let fake = Arc::new(Fake(Mutex::new(Vec::new())));
        let s = Server::start(0, TOKEN.into(), fake.clone()).unwrap();
        (s, fake)
    }

    /// Sends raw HTTP so headers the tests need (Host, Origin) can be set exactly. Returns (status, body).
    fn raw(port: u16, head: &str, body: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let req = format!("{head}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        let status = out.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
        (status, out.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
    }

    fn post(port: u16, extra: &str, body: &Value) -> (u16, Value) {
        let head = format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json{extra}");
        let (c, b) = raw(port, &head, &body.to_string());
        (c, serde_json::from_str(&b).unwrap_or(Value::Null))
    }

    #[test]
    fn the_tool_list_is_valid_and_has_no_approval_spending_or_delivery_tool() {
        let t = tools();
        assert!(t.len() >= 8);
        for tool in &t {
            let n = tool["name"].as_str().unwrap();
            assert!(!tool["description"].as_str().unwrap().is_empty() && tool["inputSchema"]["type"] == "object", "{n}");
            assert!(!n.contains("approve") && !n.contains("deliver") && !n.contains("export") && !n.contains("spend") && !n.contains("pay"), "a tool that decides what only the person decides: {n}");
        }
        let names: Vec<&str> = t.iter().map(|x| x["name"].as_str().unwrap()).collect();
        for need in ["greenroom_status", "create_project", "plan_production", "run_production", "get_production_status"] {
            assert!(names.contains(&need), "{need}");
        }
    }

    #[test]
    fn a_session_initialises_lists_tools_and_calls_one() {
        let (s, fake) = start();
        let (c, v) = post(s.port, "", &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}));
        assert_eq!(c, 200);
        assert_eq!(v["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(v["result"]["serverInfo"]["name"], "greenroom-local");
        assert!(v["result"]["capabilities"]["tools"].is_object());
        let (c2, _) = post(s.port, "", &json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        assert_eq!(c2, 202, "a notification is accepted with no body");
        let (_, l) = post(s.port, "", &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
        assert!(l["result"]["tools"].as_array().unwrap().len() >= 8);
        let (_, r) = post(s.port, "", &json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_project","arguments":{"name":"Test","script":"ADA: Hi."}}}));
        assert_eq!(r["result"]["isError"], false);
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("create_project"));
        assert_eq!(fake.0.lock().unwrap()[0].1["name"], "Test");
        let (_, p) = post(s.port, "", &json!({"jsonrpc":"2.0","id":4,"method":"ping"}));
        assert_eq!(p["result"], json!({}));
        let (_, e) = post(s.port, "", &json!({"jsonrpc":"2.0","id":5,"method":"nope"}));
        assert_eq!(e["error"]["code"], -32601);
    }

    #[test]
    fn an_unsupported_protocol_version_is_answered_with_one_the_server_has() {
        let (s, _) = start();
        let (_, v) = post(s.port, "", &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}));
        assert!(SUPPORTED.contains(&v["result"]["protocolVersion"].as_str().unwrap()));
    }

    #[test]
    fn no_token_or_the_wrong_token_is_refused_before_anything_runs() {
        let (s, fake) = start();
        let body = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"greenroom_status","arguments":{}}}).to_string();
        let (c, _) = raw(s.port, &format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}", s.port), &body);
        assert_eq!(c, 401);
        let (c, _) = raw(s.port, &format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer 0123456789abcdef0123456789abcdef0123456789abcdee", s.port), &body);
        assert_eq!(c, 401);
        let (c, _) = raw(s.port, &format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Basic abc", s.port), &body);
        assert_eq!(c, 401);
        assert!(fake.0.lock().unwrap().is_empty(), "a refused request must not reach a tool");
    }

    #[test]
    fn a_web_page_or_another_host_cannot_reach_it() {
        let (s, fake) = start();
        let body = json!({"jsonrpc":"2.0","id":1,"method":"ping"}).to_string();
        let auth = format!("Authorization: Bearer {TOKEN}");
        let (c, _) = raw(s.port, &format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n{auth}\r\nOrigin: https://evil.example", s.port), &body);
        assert_eq!(c, 403, "a foreign Origin");
        let (c, _) = raw(s.port, &format!("POST /mcp HTTP/1.1\r\nHost: evil.example\r\n{auth}"), &body);
        assert_eq!(c, 403, "a rebound host name");
        let (c, _) = raw(s.port, &format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n{auth}\r\nOrigin: http://localhost:3000", s.port), &body);
        assert_eq!(c, 200, "a local Origin is fine");
        assert!(fake.0.lock().unwrap().is_empty());
    }

    #[test]
    fn wrong_paths_methods_and_bodies_are_refused() {
        let (s, _) = start();
        let auth = format!("Authorization: Bearer {TOKEN}");
        let h = |m: &str, p: &str| format!("{m} {p} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n{auth}", s.port);
        assert_eq!(raw(s.port, &h("GET", "/mcp"), "").0, 405);
        assert_eq!(raw(s.port, &h("POST", "/other"), "{}").0, 404);
        assert_eq!(raw(s.port, &h("POST", "/mcp"), "not json").0, 400);
        let big = "x".repeat(MAX_BODY + 10);
        assert_eq!(raw(s.port, &h("POST", "/mcp"), &big).0, 413);
        let chunked = format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n{auth}\r\nTransfer-Encoding: chunked", s.port);
        assert_eq!(raw(s.port, &chunked, "0\r\n\r\n").0, 400);
    }

    #[test]
    fn tool_arguments_are_checked_against_the_schema() {
        let (s, fake) = start();
        let call = |name: &str, args: Value| post(s.port, "", &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":args}})).1;
        assert_eq!(call("nope", json!({}))["error"]["code"], -32602);
        assert!(call("create_project", json!({}))["error"]["message"].as_str().unwrap().contains("Missing argument: name"));
        assert!(call("create_project", json!({"name": 5}))["error"]["message"].as_str().unwrap().contains("must be text"));
        assert!(call("create_project", json!({"name":"x","extra":1}))["error"]["message"].as_str().unwrap().contains("Unknown argument"));
        assert!(call("create_project", json!({"name": "x".repeat(81)}))["error"]["message"].as_str().unwrap().contains("too long"));
        assert!(call("plan_production", json!({"brief":"b","mode":"manual"}))["error"]["message"].as_str().unwrap().contains("must be one of"));
        assert!(call("plan_production", json!({"brief":"b","cloud_limit": 5000}))["error"]["message"].as_str().unwrap().contains("out of range"));
        assert!(call("plan_production", json!({"brief":"b","local_only":"yes"}))["error"]["message"].as_str().unwrap().contains("true or false"));
        assert!(fake.0.lock().unwrap().is_empty(), "nothing invalid reached a tool");
        assert_eq!(call("plan_production", json!({"brief":"podcast","mode":"guided","local_only":true,"cloud_limit":0}))["result"]["isError"], false);
    }

    #[test]
    fn a_tool_error_is_reported_as_a_tool_error_not_a_crash() {
        let (s, _) = start();
        let (_, r) = post(s.port, "", &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"open_project","arguments":{"id":"missing"}}}));
        assert_eq!(r["result"]["isError"], true);
        assert_eq!(r["result"]["content"][0]["text"], "Could not open that project.");
    }

    #[test]
    fn a_batch_is_answered_in_order_and_notifications_in_it_are_skipped() {
        let (s, _) = start();
        let (c, v) = post(s.port, "", &json!([{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":2,"method":"ping"}]));
        assert_eq!(c, 200);
        assert_eq!(v.as_array().unwrap().iter().map(|x| x["id"].clone()).collect::<Vec<_>>(), vec![json!(1), json!(2)]);
    }

    #[test]
    fn a_stopped_server_stops_listening_and_a_busy_port_is_explained() {
        let (s, _) = start();
        let port = s.port;
        let e = Server::start(port, TOKEN.into(), Arc::new(Fake(Mutex::new(Vec::new())))).err().unwrap();
        assert!(e.contains("already in use"), "{e}");
        s.stop();
        std::thread::sleep(Duration::from_millis(200));
        drop(s);
        std::thread::sleep(Duration::from_millis(100));
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
        assert!(Server::start(0, "short".into(), Arc::new(Fake(Mutex::new(Vec::new())))).is_err(), "a short token is never accepted");
    }

    #[test]
    fn constant_time_compare_and_tokens() {
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "abcd") && !same("", "a") && same("", ""));
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert!(local_origin("http://localhost:5173") && local_origin("http://127.0.0.1") && local_origin("http://[::1]:80") && !local_origin("https://localhost.evil.example") && !local_origin("null") && !local_origin(""));
    }
}
