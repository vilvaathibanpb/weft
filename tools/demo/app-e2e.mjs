#!/usr/bin/env node
/**
 * End-to-end smoke test against the REAL running Weft app + the REAL mcp-shim.
 *
 * It stands in for the Chrome extension with a WebSocket client (Node 18+ global WebSocket):
 * connects to the app's capture socket, converts a site, reports a few requests, and answers
 * replay commands. Then it spawns the actual `mcp-shim/index.js` (what AI clients spawn) and
 * speaks MCP JSON-RPC through it, asserting the tools return the captured data and that a live
 * `call_endpoint` replay round-trips back through the bridge.
 *
 * Requires the app to be running (npm run tauri dev). Exits non-zero on any failed assertion.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIM = path.resolve(__dirname, "..", "..", "mcp-shim", "index.js");
const ORIGIN = "https://app.linear.app";
const ok = (c, m) => { if (!c) { console.error(`  ✗ ${m}`); process.exitCode = 1; throw new Error(m); } console.log(`  ✓ ${m}`); };

/* ---- 1. stand-in extension over the capture WebSocket ---- */
const ws = new WebSocket("ws://127.0.0.1:8787");
const wsReady = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("WS connect failed — is the app running?")); });
ws.onmessage = (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.t === "replay") {
    // Pretend the live page returned JSON.
    ws.send(JSON.stringify({ t: "replay_result", id: m.id, status: 200,
      headers: [{ k: "content-type", v: "application/json" }],
      body: JSON.stringify([{ id: 1, title: "first issue" }]) }));
  }
};

/* ---- 2. MCP over the real shim ---- */
let seq = 1; const pending = new Map();
let shim;
function rpc(method, params) {
  const id = seq++;
  return new Promise((resolve) => { pending.set(id, resolve); shim.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await wsReady;
  console.log("connected to app capture socket (as stand-in extension)");
  ws.send(JSON.stringify({ t: "hello", browser: "node-e2e", token: "", profile: "default" }));
  ws.send(JSON.stringify({ t: "convert", origin: ORIGIN }));
  ws.send(JSON.stringify({ t: "cookies", origin: ORIGIN, cookies: [{ name: "linear_session" }, { name: "csrf" }] }));
  for (const [m, u, s] of [["GET", `${ORIGIN}/api/issues?mine=1`, 200], ["GET", `${ORIGIN}/api/issues/42`, 200], ["POST", `${ORIGIN}/api/issues`, 201]])
    ws.send(JSON.stringify({ t: "request", origin: ORIGIN, req: { method: m, url: u }, res: { status: s } }));
  await sleep(400);

  shim = spawn("node", [SHIM], { stdio: ["pipe", "pipe", "inherit"] });
  readline.createInterface({ input: shim.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const r = pending.get(msg.id); if (r) { pending.delete(msg.id); r(msg); }
  });

  const init = await rpc("initialize", { protocolVersion: "2024-11-05", clientInfo: { name: "app-e2e" } });
  ok(init.result?.serverInfo?.name === "weft", `initialize via shim → ${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);

  const tools = await rpc("tools/list");
  ok((tools.result?.tools?.length ?? 0) >= 9, `tools/list → ${tools.result?.tools?.length} tools`);

  const sites = await rpc("tools/call", { name: "list_sites", arguments: {} });
  ok(sites.result.content[0].text.includes("app-linear-app"), "list_sites includes the converted site");

  const eps = await rpc("tools/call", { name: "list_endpoints", arguments: { site: "app-linear-app" } });
  const epsText = eps.result.content[0].text;
  ok(epsText.includes("/api/issues") && epsText.includes("/api/issues/{id}"), "list_endpoints shows deduped, templated paths");

  const spec = await rpc("tools/call", { name: "get_openapi", arguments: { site: "app-linear-app" } });
  ok(spec.result.content[0].text.includes("3.1.0"), "get_openapi returns a 3.1 spec");

  const write = await rpc("tools/call", { name: "call_endpoint", arguments: { site: "app-linear-app", method: "POST", path: "/api/issues", body: "{}" } });
  ok(write.result.isError && /confirm/i.test(write.result.content[0].text), "write call refused without confirm (consent gate)");

  const call = await rpc("tools/call", { name: "call_endpoint", arguments: { site: "app-linear-app", path: "/api/issues" } });
  const callText = call.result.content[0].text;
  ok(callText.includes('"status": 200') && callText.includes("first issue"), "call_endpoint replays live through the bridge and returns the body");

  console.log("\n  ALL CHECKS PASSED — real app + real shim, end to end.\n");
} catch (e) {
  console.error(`\n  FAILED: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  try { shim?.kill(); } catch {}
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(process.exitCode ?? 0), 100);
}
