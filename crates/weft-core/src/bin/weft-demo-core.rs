//! A standalone, pre-seeded Weft core for demos and manual testing — the *real* WS + MCP servers
//! from the library, with a handful of endpoints already observed so you can drive the MCP tools
//! without a browser. Not used by the app; handy for recording the terminal demo.
//!
//!   cargo run --bin weft-demo-core        # ws 127.0.0.1:8787, mcp 127.0.0.1:8788 (empty token)

use std::sync::{Arc, Mutex};
use weft_core::bridge::Bridge;
use weft_core::state::{CoreState, Shared};

#[tokio::main]
async fn main() {
    let mut st = CoreState::default();
    let origin = "https://app.linear.app";
    for (method, url, status) in [
        (
            "GET",
            "https://app.linear.app/api/issues?assignee=me&state=open",
            200,
        ),
        ("GET", "https://app.linear.app/api/issues/42", 200),
        (
            "GET",
            "https://app.linear.app/api/issues/8d1f6c2a-0b55-4a7e-9f3c-2c963f66afa6",
            200,
        ),
        ("GET", "https://app.linear.app/api/teams/7/members", 200),
        ("GET", "https://app.linear.app/api/projects", 200),
        ("POST", "https://app.linear.app/api/issues", 201),
        ("PATCH", "https://app.linear.app/api/issues/42", 200),
    ] {
        st.observe(origin, method, url, status);
    }
    st.set_cookies(origin, vec!["linear_session".into(), "csrf".into()]);
    st.set_storage(
        origin,
        vec!["workspace".into(), "feature_flags".into()],
        vec!["draft".into()],
    );

    let shared: Shared = Arc::new(Mutex::new(st));
    let bridge = Arc::new(Bridge::new());

    let (s1, b1) = (shared.clone(), bridge.clone());
    tokio::spawn(async move {
        weft_core::ws::serve(s1, b1, Arc::new(|| {})).await.ok();
    });
    let (s2, b2) = (shared.clone(), bridge.clone());
    tokio::spawn(async move {
        weft_core::mcp::serve(s2, b2, String::new()).await.ok();
    });

    eprintln!("[weft-demo] core up — ws 127.0.0.1:8787, mcp 127.0.0.1:8788 (seeded: {origin})");
    futures_util::future::pending::<()>().await;
}
