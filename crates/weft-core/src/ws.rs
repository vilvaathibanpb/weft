//! Extension ↔ core WebSocket server. Loopback only.
//!
//! Ingests the session snapshot + live network traffic from the extension and folds it into the
//! shared [`CoreState`]. It also owns the socket, so it registers a writer channel on the
//! [`Bridge`] — that's how the MCP server pushes `replay`/`probe` commands to the browser and
//! how their results get matched back. Messages mirror `ExtMessage` / `CoreCommand` in
//! `@weft/protocol`.

use crate::bridge::{Bridge, ReplayResult};
use crate::state::Shared;
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::State,
    response::Response,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;

/// Called after any state change so the UI can refresh (Tauri emits an event here).
pub type Notifier = Arc<dyn Fn() + Send + Sync>;

#[derive(Clone)]
struct Ctx {
    shared: Shared,
    bridge: Arc<Bridge>,
    notify: Notifier,
}

/// Bind `127.0.0.1:WS_PORT` and serve.
pub async fn serve(shared: Shared, bridge: Arc<Bridge>, notify: Notifier) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", crate::WS_PORT)).await?;
    eprintln!(
        "[weft] ws core listening on ws://127.0.0.1:{}",
        crate::WS_PORT
    );
    serve_on(listener, shared, bridge, notify).await
}

/// Serve on an already-bound listener (used by tests with an ephemeral port).
pub async fn serve_on(
    listener: tokio::net::TcpListener,
    shared: Shared,
    bridge: Arc<Bridge>,
    notify: Notifier,
) -> std::io::Result<()> {
    let ctx = Ctx {
        shared,
        bridge,
        notify,
    };
    let app = Router::new().route("/", get(upgrade)).with_state(ctx);
    axum::serve(listener, app).await
}

async fn upgrade(ws: WebSocketUpgrade, State(ctx): State<Ctx>) -> Response {
    ws.on_upgrade(move |socket| handle(socket, ctx))
}

async fn handle(socket: WebSocket, ctx: Ctx) {
    let (mut sink, mut stream) = socket.split();

    // A dedicated writer task drains this channel to the socket, so both the WS read loop and
    // the MCP server (via the bridge) can push frames to the extension concurrently.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            if sink.send(Message::Text(frame)).await.is_err() {
                break;
            }
        }
    });

    // Tell the extension how to behave (redact values, capture bodies).
    let _ = out_tx.send(r#"{"t":"config","redact":true,"captureBodies":true}"#.to_string());
    ctx.bridge.set_extension(Some(out_tx));

    while let Some(Ok(msg)) = stream.next().await {
        if let Message::Text(txt) = msg {
            handle_message(&txt, &ctx);
        }
    }

    // Extension went away — stop advertising it, so MCP calls fail fast instead of hanging.
    ctx.bridge.set_extension(None);
    writer.abort();
}

/// Parse one ExtMessage and apply it. Keeps lock scopes tiny; notifies after releasing.
fn handle_message(txt: &str, ctx: &Ctx) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(txt) else {
        return;
    };
    let mut changed = false;

    match v.get("t").and_then(|t| t.as_str()) {
        Some("hello") => {
            // TODO: enforce the paired token here. Dev accepts any.
            eprintln!(
                "[weft] extension connected ({})",
                v.get("browser").and_then(|b| b.as_str()).unwrap_or("?")
            );
        }
        Some("convert") => {
            if let Some(origin) = v.get("origin").and_then(|o| o.as_str()) {
                ctx.shared.lock().unwrap().ensure(origin);
                eprintln!("[weft] convert {origin}");
                changed = true;
            }
        }
        Some("request") => {
            let origin = v.get("origin").and_then(|o| o.as_str()).unwrap_or("");
            let method = v
                .get("req")
                .and_then(|r| r.get("method"))
                .and_then(|m| m.as_str())
                .unwrap_or("GET");
            let url = v
                .get("req")
                .and_then(|r| r.get("url"))
                .and_then(|u| u.as_str())
                .unwrap_or("");
            let status = v
                .get("res")
                .and_then(|r| r.get("status"))
                .and_then(|s| s.as_u64())
                .unwrap_or(0) as u16;
            if !origin.is_empty() && !url.is_empty() {
                ctx.shared
                    .lock()
                    .unwrap()
                    .observe(origin, method, url, status);
                changed = true;
            }
        }
        Some("cookies") => {
            let origin = v.get("origin").and_then(|o| o.as_str()).unwrap_or("");
            if !origin.is_empty() {
                let names = str_field_list(v.get("cookies"), "name");
                ctx.shared.lock().unwrap().set_cookies(origin, names);
                changed = true;
            }
        }
        Some("storage") => {
            let origin = v.get("origin").and_then(|o| o.as_str()).unwrap_or("");
            if !origin.is_empty() {
                let local = kv_keys(v.get("local"));
                let session = kv_keys(v.get("session"));
                ctx.shared
                    .lock()
                    .unwrap()
                    .set_storage(origin, local, session);
                changed = true;
            }
        }
        Some("replay_result") => {
            if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                let status = v.get("status").and_then(|s| s.as_u64()).unwrap_or(0) as u16;
                let body = v
                    .get("body")
                    .and_then(|b| b.as_str())
                    .map(|s| s.to_string());
                let headers = v
                    .get("headers")
                    .and_then(|h| h.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|kv| {
                                Some((
                                    kv.get("k")?.as_str()?.to_string(),
                                    kv.get("v")?.as_str()?.to_string(),
                                ))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                ctx.bridge.fulfill(
                    id,
                    ReplayResult {
                        status,
                        headers,
                        body,
                    },
                );
            }
        }
        Some("probe_result") => {
            if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                let status = v.get("status").and_then(|s| s.as_u64()).unwrap_or(0) as u16;
                ctx.bridge.fulfill(
                    id,
                    ReplayResult {
                        status,
                        headers: vec![],
                        body: None,
                    },
                );
            }
        }
        _ => {}
    }

    if changed {
        (ctx.notify)();
    }
}

/// Pull a string field out of each object in an array: `[{name:"a"},…]` → `["a",…]`.
fn str_field_list(v: Option<&serde_json::Value>, field: &str) -> Vec<String> {
    v.and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|o| o.get(field).and_then(|s| s.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Pull the `k` of each `{k,v}` entry: a storage KV array → its keys.
fn kv_keys(v: Option<&serde_json::Value>) -> Vec<String> {
    str_field_list(v, "k")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::CoreState;
    use std::sync::Mutex;
    use tokio_tungstenite::tungstenite::Message as TMsg;

    #[tokio::test]
    async fn ingest_builds_model_over_ws() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let shared: Shared = Arc::new(Mutex::new(CoreState::default()));
        let probe = shared.clone();
        let bridge = Arc::new(Bridge::new());
        tokio::spawn(serve_on(listener, shared, bridge, Arc::new(|| {})));

        let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/"))
            .await
            .unwrap();
        let send = TMsg::Text;
        ws.send(send(
            r#"{"t":"hello","token":"","browser":"chrome","profile":"default"}"#.into(),
        ))
        .await
        .unwrap();
        ws.send(send(
            r#"{"t":"convert","origin":"https://app.linear.app"}"#.into(),
        ))
        .await
        .unwrap();
        ws.send(send(r#"{"t":"cookies","origin":"https://app.linear.app","cookies":[{"name":"session"},{"name":"csrf"}]}"#.into())).await.unwrap();
        ws.send(send(r#"{"t":"request","origin":"https://app.linear.app","req":{"method":"GET","url":"https://app.linear.app/api/issues"},"res":{"status":200}}"#.into())).await.unwrap();
        ws.send(send(r#"{"t":"request","origin":"https://app.linear.app","req":{"method":"GET","url":"https://app.linear.app/api/issues/42"},"res":{"status":200}}"#.into())).await.unwrap();
        ws.send(send(r#"{"t":"request","origin":"https://app.linear.app","req":{"method":"POST","url":"https://app.linear.app/api/issues"},"res":{"status":201}}"#.into())).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let s = probe.lock().unwrap();
        assert_eq!(s.mcps.len(), 1, "one MCP should be created");
        let mcp = &s.mcps[0];
        assert_eq!(mcp.origin, "https://app.linear.app");
        assert_eq!(
            mcp.status, "ready",
            "should flip to ready after first endpoint"
        );
        assert_eq!(
            mcp.endpoint_count, 3,
            "GET /api/issues, GET /api/issues/{{id}}, POST /api/issues"
        );
        assert_eq!(
            s.auth_of("https://app.linear.app").cookie_names,
            vec!["session", "csrf"]
        );
        assert_eq!(
            s.recent(10).len(),
            3,
            "three requests recorded in the live feed"
        );
    }
}
