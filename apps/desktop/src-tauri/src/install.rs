//! Register (or launch) Weft's MCP server in each AI client, from inside the app.
//!
//! This is the native counterpart of `scripts/weft-install.mjs`: every client launches the same
//! tiny stdio shim (`mcp-shim/index.js`), and we write exactly one `weft` entry into that client's
//! own config file, non-destructively — read what's there, change only the `weft` server, write it
//! back. No cwd assumptions, no `node scripts/...` the user has to run by hand.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Clients we know how to wire up. `gui_app` is the macOS .app name to launch (None = CLI tool).
struct ClientDef {
    id: &'static str,
    label: &'static str,
    gui_app: Option<&'static str>,
}

fn clients() -> &'static [ClientDef] {
    &[
        ClientDef { id: "claude-code", label: "Claude Code", gui_app: None },
        ClientDef { id: "claude-desktop", label: "Claude Desktop", gui_app: Some("Claude") },
        ClientDef { id: "codex", label: "Codex", gui_app: None },
        ClientDef { id: "cursor", label: "Cursor", gui_app: Some("Cursor") },
    ]
}

fn client(id: &str) -> Result<&'static ClientDef, String> {
    clients().iter().find(|c| c.id == id).ok_or_else(|| format!("unknown client \"{id}\""))
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// Where each client keeps its MCP-server config, and in what format.
enum Format {
    Json,
    Toml,
}
fn config_for(id: &str) -> Result<(PathBuf, Format), String> {
    let h = home();
    Ok(match id {
        // Claude Code keeps user-scope MCP servers in ~/.claude.json under "mcpServers".
        "claude-code" => (h.join(".claude.json"), Format::Json),
        "claude-desktop" => {
            #[cfg(target_os = "macos")]
            let p = h.join("Library").join("Application Support").join("Claude").join("claude_desktop_config.json");
            #[cfg(target_os = "windows")]
            let p = PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("Claude").join("claude_desktop_config.json");
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let p = h.join(".config").join("Claude").join("claude_desktop_config.json");
            (p, Format::Json)
        }
        "cursor" => (h.join(".cursor").join("mcp.json"), Format::Json),
        "codex" => (h.join(".codex").join("config.toml"), Format::Toml),
        other => return Err(format!("no config mapping for {other}")),
    })
}

/// Absolute path to a `node` binary. Prefer a real path so clients launched from the GUI (which
/// don't inherit a version-manager PATH) can still spawn the shim; fall back to bare `node`.
fn node_bin() -> String {
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(out) = std::process::Command::new("/bin/sh").args(["-lc", "command -v node"]).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    // Resolve symlinks (a version manager like fnm/nvm hands back a session-scoped
                    // shim) to the stable install path, so the entry keeps working after the shell
                    // session ends or the machine reboots — and when a GUI client spawns it.
                    return std::fs::canonicalize(&p)
                        .map(|c| c.to_string_lossy().to_string())
                        .unwrap_or(p);
                }
            }
        }
    }
    "node".into()
}

/// Locate `mcp-shim/index.js` — bundled next to the app in a release, or in the repo during dev.
fn shim_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("mcp-shim").join("index.js"));
    }
    // Dev: this file compiles at <repo>/apps/desktop/src-tauri — the shim is three levels up.
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..").join("..").join("..").join("mcp-shim").join("index.js");
    candidates.push(dev);

    for c in candidates {
        if c.exists() {
            return Ok(c.canonicalize().unwrap_or(c));
        }
    }
    Err("could not find mcp-shim/index.js (expected in the app bundle or the repo)".into())
}

fn upsert_json(path: &Path, node: &str, shim: &str) -> Result<(), String> {
    let mut doc: serde_json::Value = if path.exists() {
        let s = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        if s.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&s).map_err(|e| format!("{} is not valid JSON ({e}) — fix or move it first", path.display()))?
        }
    } else {
        serde_json::json!({})
    };
    if !doc.is_object() {
        return Err(format!("{} is not a JSON object", path.display()));
    }
    let obj = doc.as_object_mut().unwrap();
    let servers = obj.entry("mcpServers").or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    servers.as_object_mut().unwrap().insert(
        "weft".into(),
        serde_json::json!({ "command": node, "args": [shim] }),
    );
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    let out = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())? + "\n";
    fs::write(path, out).map_err(|e| format!("write {}: {e}", path.display()))
}

fn toml_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Codex is TOML. We avoid a TOML dependency by editing just the `[mcp_servers.weft]` block:
/// drop any existing one, then append a fresh block.
fn upsert_codex_toml(path: &Path, node: &str, shim: &str) -> Result<(), String> {
    let existing = if path.exists() {
        fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?
    } else {
        String::new()
    };
    let mut out: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in existing.lines() {
        let t = line.trim_start();
        if t.starts_with('[') {
            skipping = t.starts_with("[mcp_servers.weft]");
            if skipping {
                continue;
            }
        }
        if skipping {
            continue;
        }
        out.push(line);
    }
    let mut text = out.join("\n");
    while text.ends_with('\n') {
        text.pop();
    }
    if !text.is_empty() {
        text.push('\n');
    }
    text.push_str(&format!(
        "\n[mcp_servers.weft]\ncommand = {}\nargs = [{}]\n",
        toml_quote(node),
        toml_quote(shim),
    ));
    let text = text.trim_start_matches('\n').to_string();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    fs::write(path, text).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Write the `weft` MCP entry into the client's config. Returns the file path touched.
pub fn install(app: &AppHandle, id: &str) -> Result<String, String> {
    client(id)?; // validate
    let shim = shim_path(app)?;
    let shim = shim.to_string_lossy().to_string();
    let node = node_bin();
    let (path, fmt) = config_for(id)?;
    match fmt {
        Format::Json => upsert_json(&path, &node, &shim)?,
        Format::Toml => upsert_codex_toml(&path, &node, &shim)?,
    }
    Ok(path.to_string_lossy().to_string())
}

/// Launch the client (GUI apps only). CLI clients return a note instead of launching.
pub fn open(id: &str) -> Result<String, String> {
    let c = client(id)?;
    match c.gui_app {
        Some(app_name) => {
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open").args(["-a", app_name]).spawn()
                    .map_err(|e| format!("could not open {}: {e}", c.label))?;
                // MCP servers are read at startup, so a client that was already running won't see
                // Weft until it's fully restarted.
                Ok("Opening it — if it was already running, fully quit and reopen it to load Weft.".into())
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_name;
                Ok("Start it to load Weft.".into())
            }
        }
        // CLI tools: nothing to launch — just tell the user to (re)start it.
        None => Ok("Restart it (start a new session) to load Weft.".into()),
    }
}
