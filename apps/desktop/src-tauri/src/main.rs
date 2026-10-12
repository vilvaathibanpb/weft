// Weft desktop — Tauri shell.
//
// The Rust core (weft-core) now owns the real state: the WS server ingests capture from the
// extension and folds it into the shared CoreState; these commands read/mutate that same state;
// and an "mcps-changed" event tells the UI to refresh live as capture happens.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};
use weft_core::state::{CoreState, EndpointView, Mcp, Shared};

#[tauri::command]
fn list_mcps(state: State<Shared>) -> Vec<Mcp> {
    state.lock().unwrap().mcps.clone()
}

#[tauri::command]
fn convert_site(origin: String, state: State<Shared>) -> Option<Mcp> {
    let mut s = state.lock().unwrap();
    let id = s.ensure(&origin);
    s.mcps.iter().find(|m| m.id == id).cloned()
}

#[tauri::command]
fn refresh_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    // TODO(core): send `open` to the extension, re-probe, set status from the probe result.
    state.lock().unwrap().set_status(&id, "ready")
}

#[tauri::command]
fn recapture_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    state.lock().unwrap().set_status(&id, "capturing")
}

#[tauri::command]
fn pause_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    state.lock().unwrap().set_status(&id, "paused")
}

#[tauri::command]
fn resume_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    state.lock().unwrap().set_status(&id, "ready")
}

#[tauri::command]
fn delete_mcp(id: String, state: State<Shared>) {
    state.lock().unwrap().remove(&id);
}

#[tauri::command]
fn install_client(id: String, client: String) {
    // TODO(core): write the client's MCP config pointing at mcp-shim/index.js.
    println!("install {id} into {client}");
}

#[tauri::command]
fn get_endpoints(id: String, state: State<Shared>) -> Vec<EndpointView> {
    state.lock().unwrap().endpoints_of(&id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LicenseStatus {
    licensed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    edition: Option<String>,
}

#[tauri::command]
fn activate_license(key: String) -> LicenseStatus {
    match weft_core::license::verify(&key) {
        Some(lic) => LicenseStatus {
            licensed: true,
            name: Some(lic.name),
            edition: Some(lic.edition),
        },
        None => LicenseStatus {
            licensed: false,
            name: None,
            edition: None,
        },
    }
}

#[tauri::command]
fn license_status() -> LicenseStatus {
    // TODO: read stored key from keychain and re-verify; compute trial from first-run timestamp.
    LicenseStatus {
        licensed: false,
        name: None,
        edition: None,
    }
}

fn main() {
    let shared: Shared = Arc::new(Mutex::new(CoreState::seeded()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            list_mcps,
            convert_site,
            refresh_mcp,
            recapture_mcp,
            pause_mcp,
            resume_mcp,
            delete_mcp,
            install_client,
            get_endpoints,
            activate_license,
            license_status
        ])
        .setup(move |app| {
            // Emit "mcps-changed" whenever the core mutates, so the UI refreshes live.
            let handle = app.handle().clone();
            let notify: weft_core::ws::Notifier = Arc::new(move || {
                let _ = handle.emit("mcps-changed", ());
            });

            // The live bridge is shared: the WS server owns the extension socket, and the MCP
            // server uses it to drive replays through that same browser session.
            let bridge = Arc::new(weft_core::bridge::Bridge::new());

            // Publish the handshake so `mcp-shim` can find + authenticate to the MCP socket.
            let token = weft_core::gen_token();
            let rt = weft_core::Runtime {
                ws_port: weft_core::WS_PORT,
                mcp_port: weft_core::MCP_PORT,
                token: token.clone(),
            };
            if let Err(e) = weft_core::write_runtime(&rt) {
                eprintln!("[weft] could not write runtime.json: {e}");
            }

            // Start the loopback WS server the extension connects to.
            let (s_ws, b_ws) = (shared.clone(), bridge.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = weft_core::ws::serve(s_ws, b_ws, notify).await {
                    eprintln!("[weft] ws server error: {e}");
                }
            });

            // Start the MCP control socket the shim (and thus every AI client) connects to.
            let (s_mcp, b_mcp) = (shared.clone(), bridge.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = weft_core::mcp::serve(s_mcp, b_mcp, token).await {
                    eprintln!("[weft] mcp server error: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Weft");
}
