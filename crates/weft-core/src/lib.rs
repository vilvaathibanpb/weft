//! # weft-core
//!
//! The local brain. Owns the extension link, the endpoint model, and the MCP surface.
//!
//! ```text
//!   extension ──authed ws──▶ ws::Server ──▶ model::Model ──▶ openapi::synth
//!                                   │  ▲            └────────▶ store::Store (sqlite)
//!                                   │  └── bridge (replay/probe round-trips)
//!                                   ▼
//!                             mcp::Server (JSON-RPC over loopback ◀── mcp-shim ◀── AI clients)
//! ```
//!
//! The desktop app (Tauri) embeds this crate, starts both servers in `setup()`, writes
//! `runtime.json` so the shim can find + auth us, and relays status to the UI via events.

pub mod bridge;
pub mod mcp;
pub mod model;
pub mod openapi;
pub mod state;
pub mod store;
pub mod ws;

use std::io::Write;
use std::path::PathBuf;

/// Ports + auth shared with the extension and the shim.
pub const WS_PORT: u16 = 8787; // extension ↔ core
pub const MCP_PORT: u16 = 8788; // shim ↔ core

/// Written to the per-OS app-data `runtime.json` so the extension and shim can find + auth us.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Runtime {
    pub ws_port: u16,
    pub mcp_port: u16,
    pub token: String,
}

/// 128 bits of randomness, hex-encoded — the shim must present this to reach the MCP socket.
pub fn gen_token() -> String {
    let mut buf = [0u8; 16];
    // getrandom pulls from the OS CSPRNG; if that ever fails we must not fall back to a weak
    // token, so panic rather than hand out a guessable one.
    getrandom::getrandom(&mut buf).expect("OS random source unavailable");
    hex::encode(buf)
}

/// `.../runtime.json`, mirroring where `mcp-shim` looks (see mcp-shim/index.js `configPath`).
pub fn runtime_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("dev.weft.app")
            .join("runtime.json")
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").unwrap_or(home);
        PathBuf::from(base).join("weft").join("runtime.json")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{home}/.config"));
        PathBuf::from(base).join("weft").join("runtime.json")
    }
}

/// Persist the runtime handshake file atomically-ish (write temp, rename).
pub fn write_runtime(rt: &Runtime) -> std::io::Result<()> {
    let path = runtime_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(serde_json::to_string_pretty(rt)?.as_bytes())?;
    f.flush()?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
