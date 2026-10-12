#!/usr/bin/env node
/**
 * weft-mcp-shim
 * -------------
 * AI clients (Claude Code / Claude Desktop / Codex) speak MCP over stdio and expect to *spawn*
 * their server. But the Weft core is a long-lived process inside the desktop app. This shim is
 * the bridge: each client spawns one copy, and it forwards MCP JSON-RPC (newline-delimited)
 * between the client's stdio and the core's local control socket.
 *
 * So every client shares the one running core — one endpoint model, one session state.
 *
 * Transport to core: loopback TCP, newline-delimited JSON. Port + token come from the app's
 * config file (written at pairing time). If the core isn't running, we answer the client's
 * requests ourselves with a clear MCP error instead of hanging.
 */

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_PORT = 8788; // core's MCP control socket (WS/extension port is 8787)

function configPath() {
  // Mirrors where the Tauri app stores its runtime config per-OS.
  const home = os.homedir();
  if (process.platform === "darwin")
    return path.join(home, "Library", "Application Support", "dev.weft.app", "runtime.json");
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || home, "weft", "runtime.json");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "weft", "runtime.json");
}

function loadRuntime() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const { mcpPort, token } = JSON.parse(raw);
    return { port: mcpPort || DEFAULT_PORT, token: token || "" };
  } catch {
    return { port: DEFAULT_PORT, token: "" };
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function errorFor(id, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32011, message } };
}

const { port, token } = loadRuntime();
const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
  // Authenticate the shim↔core link, then stream transparently.
  sock.write(JSON.stringify({ t: "shim_hello", token }) + "\n");
});

let coreUp = false;
sock.on("connect", () => { coreUp = true; });

// core → client
const fromCore = readline.createInterface({ input: sock });
fromCore.on("line", (line) => {
  if (line.trim()) process.stdout.write(line + "\n");
});

// client → core
const fromClient = readline.createInterface({ input: process.stdin });
fromClient.on("line", (line) => {
  if (!line.trim()) return;
  if (coreUp) {
    sock.write(line + "\n");
  } else {
    // Answer without the core so the client gets a clean error, not a stall.
    let id = null;
    try { id = JSON.parse(line).id ?? null; } catch { /* ignore */ }
    send(errorFor(id, "Weft core is not running. Open the Weft app and ensure a site is converted."));
  }
});

sock.on("error", () => { coreUp = false; });
sock.on("close", () => {
  coreUp = false;
  // Clients treat EOF as server shutdown; exit cleanly so they can respawn us.
  process.exit(0);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
