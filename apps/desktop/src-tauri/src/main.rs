// Weft desktop — Tauri shell.
//
// The Rust core (weft-core) now owns the real state: the WS server ingests capture from the
// extension and folds it into the shared CoreState; these commands read/mutate that same state;
// and an "mcps-changed" event tells the UI to refresh live as capture happens.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod install;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use weft_core::state::{CoreState, EndpointView, Mcp, RecentRequest, Shared};

/// Write the library to disk after a command mutates it. Swallows errors — a missed save must
/// never fail the user's action. The lock is released before this runs (callers scope their guard).
fn save_state(state: &Shared) {
    if let Ok(s) = state.lock() {
        s.save(&weft_core::state_path());
    }
}

#[tauri::command]
fn list_mcps(state: State<Shared>) -> Vec<Mcp> {
    state.lock().unwrap().mcps.clone()
}

#[tauri::command]
fn convert_site(origin: String, state: State<Shared>) -> Option<Mcp> {
    let m = {
        let mut s = state.lock().unwrap();
        let id = s.ensure(&origin);
        s.mcps.iter().find(|m| m.id == id).cloned()
    };
    save_state(&state);
    m
}

#[tauri::command]
fn refresh_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    // TODO(core): send `open` to the extension, re-probe, set status from the probe result.
    let m = state.lock().unwrap().set_status(&id, "ready");
    save_state(&state);
    m
}

#[tauri::command]
fn recapture_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    let m = state.lock().unwrap().set_status(&id, "capturing");
    save_state(&state);
    m
}

#[tauri::command]
fn pause_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    let m = state.lock().unwrap().set_status(&id, "paused");
    save_state(&state);
    m
}

#[tauri::command]
fn resume_mcp(id: String, state: State<Shared>) -> Option<Mcp> {
    let m = state.lock().unwrap().set_status(&id, "ready");
    save_state(&state);
    m
}

#[tauri::command]
fn delete_mcp(id: String, state: State<Shared>) {
    state.lock().unwrap().remove(&id);
    save_state(&state);
}

#[tauri::command]
fn get_endpoints(id: String, state: State<Shared>) -> Vec<EndpointView> {
    state.lock().unwrap().endpoints_of(&id)
}

/// The synthesized OpenAPI 3.1 spec for one site (observed traffic only), pretty-printed.
#[tauri::command]
fn export_openapi(id: String, state: State<Shared>) -> Option<String> {
    let s = state.lock().unwrap();
    let m = s.resolve(&id)?;
    let doc = weft_core::openapi::synth(&m.name, &m.origin, &s.model_endpoints(&m.origin));
    serde_json::to_string_pretty(&doc).ok()
}

/// Recent captured requests across all sites — the app's local activity feed.
#[tauri::command]
fn recent_activity(state: State<Shared>) -> Vec<RecentRequest> {
    state.lock().unwrap().recent(50)
}

/// Write the `weft` MCP entry into a client's own config file. Returns the file path touched.
#[tauri::command]
fn install_client(app: AppHandle, client: String) -> Result<String, String> {
    install::install(&app, &client)
}

/// Launch the client (GUI apps) so it picks up the newly installed server.
#[tauri::command]
fn open_client(client: String) -> Result<String, String> {
    install::open(&client)
}

fn main() {
    // Restore the library persisted from previous runs (empty on first launch).
    let shared: Shared = Arc::new(Mutex::new(CoreState::load(&weft_core::state_path())));

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
            get_endpoints,
            recent_activity,
            export_openapi,
            install_client,
            open_client
        ])
        .setup(move |app| {
            // On every live capture change: refresh the UI *and* persist, so sites and their
            // endpoint models survive a restart. notify() is always called with the lock released
            // (see ws::handle_message), so re-locking to save here can't deadlock.
            let handle = app.handle().clone();
            let persist_shared = shared.clone();
            let notify: weft_core::ws::Notifier = Arc::new(move || {
                let _ = handle.emit("mcps-changed", ());
                if let Ok(s) = persist_shared.lock() {
                    s.save(&weft_core::state_path());
                }
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
