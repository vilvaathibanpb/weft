//! Full-stack proof: an AI client (here, raw MCP JSON-RPC over TCP, exactly what `mcp-shim`
//! forwards) talks to the real MCP server, which drives a real replay through a stand-in
//! "extension" connected over the real WS server. Both servers share one CoreState + Bridge,
//! just like inside the Tauri app.

use futures_util::{SinkExt, StreamExt};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message as TMsg;
use weft_core::bridge::Bridge;
use weft_core::state::{CoreState, Shared};

/// Minimal line-oriented MCP client over TCP.
struct Client {
    wr: tokio::net::tcp::OwnedWriteHalf,
    lines: tokio::io::Lines<BufReader<tokio::net::tcp::OwnedReadHalf>>,
}

impl Client {
    async fn connect(port: u16, token: &str) -> Self {
        let sock = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let (rd, mut wr) = sock.into_split();
        // Handshake exactly as the shim does.
        wr.write_all(format!("{{\"t\":\"shim_hello\",\"token\":\"{token}\"}}\n").as_bytes())
            .await
            .unwrap();
        Self {
            wr,
            lines: BufReader::new(rd).lines(),
        }
    }

    async fn rpc(&mut self, line: &str) -> serde_json::Value {
        self.wr.write_all(line.as_bytes()).await.unwrap();
        self.wr.write_all(b"\n").await.unwrap();
        let resp = self
            .lines
            .next_line()
            .await
            .unwrap()
            .expect("response line");
        serde_json::from_str(&resp).unwrap()
    }
}

#[tokio::test]
async fn ai_client_reads_and_replays_through_the_core() {
    let shared: Shared = Arc::new(Mutex::new(CoreState::default()));
    let bridge = Arc::new(Bridge::new());
    let token = "test-token".to_string();

    // Bind ephemeral ports and start both servers on the shared state + bridge.
    let ws_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_addr = ws_listener.local_addr().unwrap();
    let mcp_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mcp_port = mcp_listener.local_addr().unwrap().port();

    {
        let (s, b) = (shared.clone(), bridge.clone());
        tokio::spawn(async move {
            weft_core::ws::serve_on(ws_listener, s, b, Arc::new(|| {}))
                .await
                .ok();
        });
    }
    {
        let (s, b, t) = (shared.clone(), bridge.clone(), token.clone());
        tokio::spawn(async move {
            weft_core::mcp::serve_on(mcp_listener, s, b, t).await.ok();
        });
    }

    // Stand-in extension: connect over WS, convert a site, report traffic, and answer replays
    // with the live session's "response".
    let (mut ext, _) = tokio_tungstenite::connect_async(format!("ws://{ws_addr}/"))
        .await
        .unwrap();
    let say = |s: &str| TMsg::Text(s.to_string());
    ext.send(say(
        r#"{"t":"hello","browser":"chrome","token":"","profile":"default"}"#,
    ))
    .await
    .unwrap();
    ext.send(say(r#"{"t":"convert","origin":"https://app.linear.app"}"#))
        .await
        .unwrap();
    ext.send(say(
        r#"{"t":"cookies","origin":"https://app.linear.app","cookies":[{"name":"session"}]}"#,
    ))
    .await
    .unwrap();
    ext.send(say(r#"{"t":"request","origin":"https://app.linear.app","req":{"method":"GET","url":"https://app.linear.app/api/issues"},"res":{"status":200}}"#)).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;

    // Background: whenever the core asks the extension to replay, answer it.
    tokio::spawn(async move {
        while let Some(Ok(TMsg::Text(txt))) = ext.next().await {
            let v: serde_json::Value = match serde_json::from_str(&txt) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if v.get("t").and_then(|t| t.as_str()) == Some("replay") {
                let id = v["id"].as_str().unwrap();
                let reply = format!(
                    r#"{{"t":"replay_result","id":"{id}","status":200,"headers":[{{"k":"content-type","v":"application/json"}}],"body":"[{{\"id\":1,\"title\":\"hi\"}}]"}}"#
                );
                ext.send(say(&reply)).await.unwrap();
            }
        }
    });

    // The "AI client" side.
    let mut client = Client::connect(mcp_port, &token).await;

    let init = client
        .rpc(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#)
        .await;
    assert_eq!(init["result"]["serverInfo"]["name"], "weft");

    let tools = client
        .rpc(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#)
        .await;
    assert!(tools["result"]["tools"].as_array().unwrap().len() >= 9);

    let sites = client
        .rpc(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_sites","arguments":{}}}"#)
        .await;
    let sites_text = sites["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        sites_text.contains("app-linear-app"),
        "captured site is listed: {sites_text}"
    );

    let endpoints = client
        .rpc(r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_endpoints","arguments":{"site":"app-linear-app"}}}"#)
        .await;
    assert!(endpoints["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("/api/issues"));

    // The headline: a real replay through the live session, end to end.
    let called = client
        .rpc(r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"call_endpoint","arguments":{"site":"app-linear-app","path":"/api/issues"}}}"#)
        .await;
    let body = called["result"]["content"][0]["text"].as_str().unwrap();
    assert!(body.contains("\"status\": 200"), "got status back: {body}");
    assert!(
        body.contains("\"title\": \"hi\""),
        "got the replayed JSON body: {body}"
    );
    assert_eq!(called["result"]["isError"], false);
}
