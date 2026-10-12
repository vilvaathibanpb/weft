//! The live link to the connected browser extension, plus in-flight replay correlation.
//!
//! The WS server (ws.rs) owns the extension socket; the MCP server (mcp.rs) needs to ask the
//! extension to replay a request using the user's live session and wait for the answer. The
//! `Bridge` is the shared rendezvous between them: the WS side registers a channel into the
//! socket writer, and either side can send a command frame; replies are matched back to the
//! awaiting MCP call by request id.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::{mpsc, oneshot};

/// The outcome of a replay/probe the extension ran against the live session.
#[derive(Clone, Debug, Serialize)]
pub struct ReplayResult {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Default)]
pub struct Bridge {
    /// Frames queued here are written to the connected extension. `None` when nothing is
    /// connected (so the MCP server can answer "no browser" immediately instead of hanging).
    ext_tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    /// Replays awaiting a `replay_result` / `probe_result`, keyed by request id.
    pending: Mutex<HashMap<String, oneshot::Sender<ReplayResult>>>,
    seq: AtomicU64,
}

impl Bridge {
    pub fn new() -> Self {
        Self::default()
    }

    /// Called by the WS server when an extension connects (`Some`) or disconnects (`None`).
    pub fn set_extension(&self, tx: Option<mpsc::UnboundedSender<String>>) {
        *self.ext_tx.lock().unwrap() = tx;
    }

    pub fn extension_connected(&self) -> bool {
        self.ext_tx.lock().unwrap().is_some()
    }

    /// Monotonic per-process request id for correlating replays.
    pub fn next_id(&self) -> String {
        format!("rq{}", self.seq.fetch_add(1, Ordering::Relaxed))
    }

    /// Send a command frame (already-serialized JSON) to the extension.
    pub fn send_to_extension(&self, frame: String) -> Result<(), &'static str> {
        match self.ext_tx.lock().unwrap().as_ref() {
            Some(tx) => tx.send(frame).map_err(|_| "extension link closed"),
            None => Err("no browser connected"),
        }
    }

    /// Register interest in a reply for `id`; await the returned receiver.
    pub fn register(&self, id: String) -> oneshot::Receiver<ReplayResult> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        rx
    }

    /// Deliver a reply to whoever is awaiting `id` (no-op if nobody is / it timed out).
    pub fn fulfill(&self, id: &str, result: ReplayResult) {
        if let Some(tx) = self.pending.lock().unwrap().remove(id) {
            let _ = tx.send(result);
        }
    }

    /// Drop a pending entry (used on timeout / send failure) so the map doesn't leak.
    pub fn cancel(&self, id: &str) {
        self.pending.lock().unwrap().remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fulfill_wakes_the_waiter() {
        let b = Bridge::new();
        let id = b.next_id();
        let rx = b.register(id.clone());
        b.fulfill(
            &id,
            ReplayResult {
                status: 200,
                headers: vec![],
                body: Some("ok".into()),
            },
        );
        let got = rx.await.unwrap();
        assert_eq!(got.status, 200);
        assert_eq!(got.body.as_deref(), Some("ok"));
    }

    #[test]
    fn reports_no_extension_until_connected() {
        let b = Bridge::new();
        assert!(!b.extension_connected());
        assert!(b.send_to_extension("{}".into()).is_err());
        let (tx, _rx) = mpsc::unbounded_channel();
        b.set_extension(Some(tx));
        assert!(b.extension_connected());
        assert!(b.send_to_extension("{}".into()).is_ok());
    }
}
