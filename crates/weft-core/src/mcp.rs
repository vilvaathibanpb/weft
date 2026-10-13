//! MCP server. Exposes the endpoint model + live replay as MCP tools over a loopback control
//! socket that `mcp-shim` connects to (so every AI client shares this one core).
//!
//! The wire protocol is MCP's JSON-RPC 2.0, newline-delimited. The shim is a transparent pipe:
//! it sends one `{"t":"shim_hello","token":…}` line to authenticate, then forwards the client's
//! JSON-RPC both ways. We implement `initialize`, `tools/list` and `tools/call` by hand.

use crate::bridge::{Bridge, ReplayResult};
use crate::state::Shared;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

/// MCP protocol revision we implement. Clients negotiate; we echo theirs when sensible.
pub const PROTOCOL_VERSION: &str = "2024-11-05";

/// How long a `call_endpoint` waits for the browser to replay before giving up.
const REPLAY_TIMEOUT: Duration = Duration::from_secs(20);

/// The tool surface. Names are stable — clients depend on them.
pub const TOOLS: &[(&str, &str)] = &[
    ("list_sites", "List origins currently captured, with status and endpoint count."),
    ("list_endpoints", "List discovered endpoints for a site: method, path template, query params, status codes."),
    ("get_endpoint", "Full detail for one endpoint of a site (method + path template)."),
    ("search_endpoints", "Substring search across endpoint methods and paths (optionally within one site)."),
    ("get_openapi", "Synthesized OpenAPI 3.1 spec for a site, from observed traffic only."),
    ("get_auth_context", "Cookie names, storage keys and auth header names detected for a site. Values are never exposed."),
    ("call_endpoint", "Replay a request against a site using the live browser session: cookies attach automatically, and auth headers the site uses (e.g. Authorization) are added inside the browser. Writes (non-GET) require confirm:true."),
    ("recent_requests", "The most recently captured requests across all sites."),
    ("status", "Status for one site (or all), so a client can tell Ready from Needs-login."),
];

/// Start the MCP control socket on `MCP_PORT`.
pub async fn serve(shared: Shared, bridge: Arc<Bridge>, token: String) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", crate::MCP_PORT)).await?;
    eprintln!("[weft] mcp core listening on 127.0.0.1:{}", crate::MCP_PORT);
    serve_on(listener, shared, bridge, token).await
}

/// Accept-loop, split out so tests can bind an ephemeral port.
pub async fn serve_on(
    listener: TcpListener,
    shared: Shared,
    bridge: Arc<Bridge>,
    token: String,
) -> std::io::Result<()> {
    loop {
        let (sock, _) = listener.accept().await?;
        let (shared, bridge, token) = (shared.clone(), bridge.clone(), token.clone());
        tokio::spawn(async move {
            if let Err(e) = handle_conn(sock, shared, bridge, token).await {
                eprintln!("[weft] mcp connection ended: {e}");
            }
        });
    }
}

async fn handle_conn(
    sock: TcpStream,
    shared: Shared,
    bridge: Arc<Bridge>,
    token: String,
) -> std::io::Result<()> {
    let (rd, mut wr) = sock.into_split();
    let mut lines = BufReader::new(rd).lines();

    // First line is the shim handshake. (If it isn't, treat it as a normal JSON-RPC line — this
    // keeps a hand-driven `nc` session usable for debugging when no token is set.)
    let Some(first) = lines.next_line().await? else {
        return Ok(());
    };
    let handshook = match serde_json::from_str::<Value>(&first) {
        Ok(v) if v.get("t").and_then(|t| t.as_str()) == Some("shim_hello") => {
            let got = v.get("token").and_then(|t| t.as_str()).unwrap_or("");
            if !token.is_empty() && got != token {
                let _ = wr
                    .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32001,\"message\":\"unauthorized\"}}\n")
                    .await;
                return Ok(());
            }
            true
        }
        Ok(v) => {
            if let Some(resp) = dispatch(&v, &shared, &bridge).await {
                write_line(&mut wr, &resp).await?;
            }
            true
        }
        Err(_) => true,
    };
    let _ = handshook;

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(resp) = dispatch(&msg, &shared, &bridge).await {
            write_line(&mut wr, &resp).await?;
        }
    }
    Ok(())
}

async fn write_line<W: AsyncWriteExt + Unpin>(wr: &mut W, v: &Value) -> std::io::Result<()> {
    let mut s = serde_json::to_string(v).unwrap_or_else(|_| "{}".into());
    s.push('\n');
    wr.write_all(s.as_bytes()).await
}

/// Route one JSON-RPC message. Returns `None` for notifications (no response expected).
async fn dispatch(msg: &Value, shared: &Shared, bridge: &Arc<Bridge>) -> Option<Value> {
    let method = msg.get("method").and_then(|m| m.as_str())?;
    let id = msg.get("id").cloned();
    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));

    match method {
        "initialize" => Some(ok(
            id,
            json!({
                "protocolVersion": params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or(PROTOCOL_VERSION),
                "serverInfo": { "name": "weft", "version": env!("CARGO_PKG_VERSION") },
                "capabilities": { "tools": {} }
            }),
        )),
        // Notifications carry no id and get no reply.
        m if m.starts_with("notifications/") => None,
        "ping" => Some(ok(id, json!({}))),
        "tools/list" => Some(ok(id, json!({ "tools": tool_specs() }))),
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let (text, is_error) = match call_tool(name, &args, shared, bridge).await {
                Ok(t) => (t, false),
                Err(t) => (t, true),
            };
            Some(ok(
                id,
                json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }),
            ))
        }
        _ => id.map(|id| err(Some(id), -32601, &format!("method not found: {method}"))),
    }
}

fn ok(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "result": result })
}

fn err(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "error": { "code": code, "message": message } })
}

fn str_schema(props: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": props, "required": required })
}

fn tool_specs() -> Vec<Value> {
    let site_prop = json!({ "site": { "type": "string", "description": "MCP id or origin, e.g. \"app-linear-app\" or \"https://app.linear.app\"." } });
    vec![
        json!({ "name": "list_sites", "description": TOOLS[0].1, "inputSchema": str_schema(json!({}), &[]) }),
        json!({ "name": "list_endpoints", "description": TOOLS[1].1, "inputSchema": str_schema(site_prop.clone(), &["site"]) }),
        json!({ "name": "get_endpoint", "description": TOOLS[2].1, "inputSchema": str_schema(json!({
            "site": site_prop["site"],
            "method": { "type": "string" },
            "path": { "type": "string", "description": "Path template, e.g. /api/issues/{id}" }
        }), &["site", "method", "path"]) }),
        json!({ "name": "search_endpoints", "description": TOOLS[3].1, "inputSchema": str_schema(json!({
            "query": { "type": "string" },
            "site": { "type": "string", "description": "Optional: restrict to one site." }
        }), &["query"]) }),
        json!({ "name": "get_openapi", "description": TOOLS[4].1, "inputSchema": str_schema(site_prop.clone(), &["site"]) }),
        json!({ "name": "get_auth_context", "description": TOOLS[5].1, "inputSchema": str_schema(site_prop.clone(), &["site"]) }),
        json!({ "name": "call_endpoint", "description": TOOLS[6].1, "inputSchema": str_schema(json!({
            "site": site_prop["site"],
            "method": { "type": "string", "default": "GET" },
            "path": { "type": "string", "description": "Path (+query), e.g. /api/issues?limit=10" },
            "headers": { "type": "object", "description": "Optional extra request headers." },
            "body": { "type": "string", "description": "Optional request body (for POST/PUT/PATCH)." },
            "confirm": { "type": "boolean", "description": "Required true for non-GET (write) calls." }
        }), &["site", "path"]) }),
        json!({ "name": "recent_requests", "description": TOOLS[7].1, "inputSchema": str_schema(json!({
            "limit": { "type": "integer", "default": 20 }
        }), &[]) }),
        json!({ "name": "status", "description": TOOLS[8].1, "inputSchema": str_schema(json!({
            "site": { "type": "string", "description": "Optional: one site. Omit for all." }
        }), &[]) }),
    ]
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_else(|_| v.to_string())
}

/// Dispatch a tool call. `Ok` text is a success payload; `Err` text becomes an MCP error result.
async fn call_tool(
    name: &str,
    args: &Value,
    shared: &Shared,
    bridge: &Arc<Bridge>,
) -> Result<String, String> {
    match name {
        "list_sites" => {
            let s = shared.lock().unwrap();
            let sites: Vec<Value> = s
                .mcps
                .iter()
                .map(|m| {
                    json!({
                        "id": m.id, "name": m.name, "origin": m.origin,
                        "status": m.status, "endpointCount": m.endpoint_count,
                        "reason": m.reason
                    })
                })
                .collect();
            Ok(pretty(&json!({ "sites": sites })))
        }

        "status" => {
            let s = shared.lock().unwrap();
            match args.get("site").and_then(|v| v.as_str()) {
                Some(key) => {
                    let m = s.resolve(key).ok_or_else(|| unknown_site(key))?;
                    Ok(pretty(
                        &json!({ "id": m.id, "status": m.status, "endpointCount": m.endpoint_count, "reason": m.reason }),
                    ))
                }
                None => {
                    let all: Vec<Value> = s
                        .mcps
                        .iter()
                        .map(|m| json!({ "id": m.id, "status": m.status }))
                        .collect();
                    Ok(pretty(&json!({ "sites": all })))
                }
            }
        }

        "list_endpoints" => {
            let key = required_str(args, "site")?;
            let s = shared.lock().unwrap();
            let m = s.resolve(key).ok_or_else(|| unknown_site(key))?;
            let eps = endpoints_json(&s.model_endpoints(&m.origin));
            Ok(pretty(
                &json!({ "site": m.id, "origin": m.origin, "endpoints": eps }),
            ))
        }

        "get_endpoint" => {
            let key = required_str(args, "site")?;
            let method = required_str(args, "method")?.to_uppercase();
            let path = required_str(args, "path")?;
            let s = shared.lock().unwrap();
            let m = s.resolve(key).ok_or_else(|| unknown_site(key))?;
            let ep = s
                .model_endpoints(&m.origin)
                .into_iter()
                .find(|e| e.method == method && e.path_template == path)
                .ok_or_else(|| format!("No endpoint {method} {path} on {}", m.id))?;
            Ok(pretty(&endpoint_json(&ep)))
        }

        "search_endpoints" => {
            let q = required_str(args, "query")?.to_lowercase();
            let only = args.get("site").and_then(|v| v.as_str());
            let s = shared.lock().unwrap();
            let mut hits: Vec<Value> = vec![];
            for m in &s.mcps {
                if let Some(site) = only {
                    if m.id != site && m.origin != site {
                        continue;
                    }
                }
                for e in s.model_endpoints(&m.origin) {
                    let hay = format!("{} {}", e.method, e.path_template).to_lowercase();
                    if hay.contains(&q) {
                        let mut j = endpoint_json(&e);
                        j["site"] = json!(m.id);
                        hits.push(j);
                    }
                }
            }
            Ok(pretty(&json!({ "query": q, "matches": hits })))
        }

        "get_openapi" => {
            let key = required_str(args, "site")?;
            let s = shared.lock().unwrap();
            let m = s.resolve(key).ok_or_else(|| unknown_site(key))?;
            let doc = crate::openapi::synth(&m.name, &m.origin, &s.model_endpoints(&m.origin));
            Ok(pretty(&doc))
        }

        "get_auth_context" => {
            let key = required_str(args, "site")?;
            let s = shared.lock().unwrap();
            let m = s.resolve(key).ok_or_else(|| unknown_site(key))?;
            let a = s.auth_of(&m.origin);
            Ok(pretty(&json!({
                "site": m.id,
                "note": "Names/keys only. Credential values are never exposed by Weft.",
                "cookieNames": a.cookie_names,
                "localStorageKeys": a.local_keys,
                "sessionStorageKeys": a.session_keys,
                "authHeaderNames": a.header_names,
                "authHeaderNote": "call_endpoint adds these headers' live values inside the browser; you never need to send them."
            })))
        }

        "recent_requests" => {
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            let s = shared.lock().unwrap();
            let recent: Vec<Value> = s
                .recent(limit)
                .into_iter()
                .map(|r| json!({ "origin": r.origin, "method": r.method, "path": r.path, "status": r.status }))
                .collect();
            Ok(pretty(&json!({ "recent": recent })))
        }

        "call_endpoint" => call_endpoint(args, shared, bridge).await,

        other => Err(format!("unknown tool: {other}")),
    }
}

/// The live-replay path: ask the connected browser to re-issue the request with the session's
/// own cookies, and return what it got back.
async fn call_endpoint(
    args: &Value,
    shared: &Shared,
    bridge: &Arc<Bridge>,
) -> Result<String, String> {
    let key = required_str(args, "site")?;
    let path = required_str(args, "path")?.to_string();
    let method = args
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();
    let body = args.get("body").and_then(|v| v.as_str()).map(String::from);
    let confirm = args
        .get("confirm")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Resolve the origin (accept a raw URL too, so a client can call before the UI lists it).
    let origin = {
        let s = shared.lock().unwrap();
        match s.resolve(key) {
            Some(m) => m.origin,
            None if key.starts_with("http") => key.to_string(),
            None => return Err(unknown_site(key)),
        }
    };

    // Consent gate: writes don't fire on a guessed call. The caller must mean it.
    if method != "GET" && !confirm {
        return Err(format!(
            "Refusing to replay a {method} (write) call to {path} without consent. \
             Re-issue with \"confirm\": true if this is intended."
        ));
    }

    if !bridge.extension_connected() {
        return Err(
            "No browser connected. Open the site in Chrome with the Weft extension running, then retry."
                .to_string(),
        );
    }

    // Translate optional headers object into the extension's [{k,v}] shape.
    let headers: Vec<Value> = args
        .get("headers")
        .and_then(|h| h.as_object())
        .map(|o| {
            o.iter()
                .map(|(k, v)| json!({ "k": k, "v": v.as_str().unwrap_or("") }))
                .collect()
        })
        .unwrap_or_default();

    let id = bridge.next_id();
    let frame = json!({
        "t": "replay", "id": id, "origin": origin, "method": method,
        "path": path, "headers": headers, "body": body
    })
    .to_string();

    let rx = bridge.register(id.clone());
    if let Err(e) = bridge.send_to_extension(frame) {
        bridge.cancel(&id);
        return Err(e.to_string());
    }

    match tokio::time::timeout(REPLAY_TIMEOUT, rx).await {
        Ok(Ok(r)) => Ok(format_replay(&origin, &method, &path, &r)),
        Ok(Err(_)) => {
            bridge.cancel(&id);
            Err("browser link dropped before the replay returned".into())
        }
        Err(_) => {
            bridge.cancel(&id);
            Err("replay timed out (no response from the browser within 20s)".into())
        }
    }
}

fn format_replay(origin: &str, method: &str, path: &str, r: &ReplayResult) -> String {
    // Try to surface JSON bodies as JSON so the model can read them structurally.
    let body_val: Value = r
        .body
        .as_deref()
        .and_then(|b| serde_json::from_str::<Value>(b).ok())
        .unwrap_or_else(|| json!(r.body));
    pretty(&json!({
        "request": { "method": method, "url": format!("{origin}{path}") },
        "status": r.status,
        "headers": r.headers.iter().map(|(k, v)| json!({ k: v })).collect::<Vec<_>>(),
        "body": body_val
    }))
}

fn endpoints_json(eps: &[crate::model::Endpoint]) -> Vec<Value> {
    eps.iter().map(endpoint_json).collect()
}

fn endpoint_json(e: &crate::model::Endpoint) -> Value {
    json!({
        "method": e.method,
        "path": e.path_template,
        "queryParams": e.query_params,
        "statusCodes": e.status_codes,
        "sampleCount": e.sample_count,
        "confidence": match e.confidence { crate::model::Confidence::High => "high", crate::model::Confidence::Low => "low" }
    })
}

fn required_str<'a>(args: &'a Value, field: &str) -> Result<&'a str, String> {
    args.get(field)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing required argument: {field}"))
}

fn unknown_site(key: &str) -> String {
    format!("unknown site: {key} (call list_sites to see available ids/origins)")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::ReplayResult;
    use crate::state::CoreState;
    use std::sync::Mutex;

    fn seeded_shared() -> Shared {
        let mut st = CoreState::default();
        st.observe(
            "https://app.linear.app",
            "GET",
            "https://app.linear.app/api/issues?mine=1",
            200,
        );
        st.observe(
            "https://app.linear.app",
            "GET",
            "https://app.linear.app/api/issues/42",
            200,
        );
        st.observe(
            "https://app.linear.app",
            "POST",
            "https://app.linear.app/api/issues",
            201,
        );
        st.set_cookies(
            "https://app.linear.app",
            vec!["session".into(), "csrf".into()],
        );
        Arc::new(Mutex::new(st))
    }

    #[tokio::test]
    async fn read_tools_return_captured_data() {
        let shared = seeded_shared();
        let bridge = Arc::new(Bridge::new());

        let sites = call_tool("list_sites", &json!({}), &shared, &bridge)
            .await
            .unwrap();
        assert!(sites.contains("app-linear-app"));

        let eps = call_tool(
            "list_endpoints",
            &json!({ "site": "https://app.linear.app" }),
            &shared,
            &bridge,
        )
        .await
        .unwrap();
        assert!(eps.contains("/api/issues"));
        assert!(eps.contains("/api/issues/{id}"));

        let spec = call_tool(
            "get_openapi",
            &json!({ "site": "app-linear-app" }),
            &shared,
            &bridge,
        )
        .await
        .unwrap();
        assert!(spec.contains("\"openapi\""));
        assert!(spec.contains("3.1.0"));

        let found = call_tool(
            "search_endpoints",
            &json!({ "query": "issues" }),
            &shared,
            &bridge,
        )
        .await
        .unwrap();
        assert!(found.contains("/api/issues"));

        let auth = call_tool(
            "get_auth_context",
            &json!({ "site": "app-linear-app" }),
            &shared,
            &bridge,
        )
        .await
        .unwrap();
        assert!(
            auth.contains("session") && auth.contains("csrf"),
            "cookie names surfaced"
        );
        // Only names/keys are ever present — the state never stores cookie values to leak.
        assert!(auth.contains("cookieNames"));
    }

    #[tokio::test]
    async fn call_endpoint_replays_via_bridge() {
        let shared = seeded_shared();
        let bridge = Arc::new(Bridge::new());

        // Stand in for the extension: accept replay frames and answer them.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        bridge.set_extension(Some(tx));
        let b2 = bridge.clone();
        tokio::spawn(async move {
            while let Some(frame) = rx.recv().await {
                let v: Value = serde_json::from_str(&frame).unwrap();
                let id = v["id"].as_str().unwrap().to_string();
                b2.fulfill(
                    &id,
                    ReplayResult {
                        status: 200,
                        headers: vec![],
                        body: Some(r#"[{"id":1}]"#.into()),
                    },
                );
            }
        });

        let out = call_tool(
            "call_endpoint",
            &json!({ "site": "app-linear-app", "path": "/api/issues" }),
            &shared,
            &bridge,
        )
        .await
        .unwrap();
        assert!(out.contains("\"status\": 200"));
        assert!(out.contains("\"id\": 1"));
    }

    #[tokio::test]
    async fn write_calls_need_confirmation() {
        let shared = seeded_shared();
        let bridge = Arc::new(Bridge::new());
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        bridge.set_extension(Some(tx));

        let res = call_tool(
            "call_endpoint",
            &json!({ "site": "app-linear-app", "method": "POST", "path": "/api/issues", "body": "{}" }),
            &shared,
            &bridge,
        )
        .await;
        assert!(res.is_err(), "POST without confirm must be refused");
        assert!(res.unwrap_err().contains("confirm"));
    }

    #[tokio::test]
    async fn initialize_and_tools_list_shape() {
        let shared = seeded_shared();
        let bridge = Arc::new(Bridge::new());

        let init = dispatch(
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
            &shared,
            &bridge,
        )
        .await
        .unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "weft");

        let listed = dispatch(
            &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
            &shared,
            &bridge,
        )
        .await
        .unwrap();
        let tools = listed["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), TOOLS.len());

        // Notifications get no reply.
        let note = dispatch(
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            &shared,
            &bridge,
        )
        .await;
        assert!(note.is_none());
    }
}
