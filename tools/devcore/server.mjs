#!/usr/bin/env node
/**
 * Weft dev core — a stand-in for the real (Rust) core's WebSocket endpoint.
 *
 * Run this, load the extension, then click "Convert this site to MCP" on any site you're logged
 * into. You'll see the session snapshot and a live, deduped list of the site's API endpoints
 * stream in here — proving the extension works end-to-end before the Rust backend is built.
 *
 *   node tools/devcore/server.mjs
 */
import { WebSocketServer } from "ws";

const PORT = 8787;
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

const C = { dim: "\x1b[2m", grn: "\x1b[32m", yel: "\x1b[33m", blu: "\x1b[36m", red: "\x1b[31m", rst: "\x1b[0m", b: "\x1b[1m" };
const log = (...a) => console.log(...a);

// origin -> Map(templateKey -> {method, template, count})
const models = new Map();

function templatize(pathname) {
  return pathname
    .split("/")
    .map((seg) =>
      /^\d+$/.test(seg) ? "{id}" :
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(seg) ? "{uuid}" :
      /^[0-9a-f]{24,}$/i.test(seg) ? "{hash}" : seg)
    .join("/") || "/";
}

log(`${C.b}Weft dev core${C.rst} listening on ${C.blu}ws://127.0.0.1:${PORT}${C.rst}`);
log(`${C.dim}Load the extension, then click "Convert this site to MCP" on a logged-in site.${C.rst}\n`);

wss.on("connection", (ws) => {
  log(`${C.grn}● extension connected${C.rst}`);
  ws.on("close", () => log(`${C.yel}○ extension disconnected${C.rst}`));

  ws.on("message", (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }

    switch (m.t) {
      case "hello":
        log(`${C.dim}hello${C.rst} browser=${m.browser} profile=${m.profile} token=${m.token ? "set" : "(none)"}`);
        ws.send(JSON.stringify({ t: "config", redact: true, captureBodies: true }));
        break;

      case "convert":
        log(`\n${C.b}${C.blu}▶ convert${C.rst} ${m.origin}`);
        models.set(m.origin, new Map());
        break;

      case "cookies":
        log(`  ${C.dim}cookies:${C.rst} ${m.cookies.length} (names only) — ${m.cookies.slice(0, 5).map((c) => c.name).join(", ")}${m.cookies.length > 5 ? "…" : ""}`);
        break;

      case "storage":
        log(`  ${C.dim}storage:${C.rst} ${m.local.length} local, ${m.session.length} session keys`);
        break;

      case "request": {
        const model = models.get(m.origin) || new Map();
        models.set(m.origin, model);
        let url;
        try { url = new URL(m.req.url); } catch { break; }
        const method = m.req.method || "GET";
        const key = method + " " + templatize(url.pathname);
        const e = model.get(key) || { method, template: templatize(url.pathname), count: 0, status: m.res.status };
        e.count++; e.status = m.res.status;
        model.set(key, e);
        log(`  ${C.grn}endpoint${C.rst} ${method.padEnd(6)} ${templatize(url.pathname)} ${C.dim}→ ${m.res.status} (${model.size} unique so far)${C.rst}`);
        break;
      }

      case "replay_result":
        log(`  ${C.dim}replay_result id=${m.id} status=${m.status}${C.rst}`);
        break;
      case "probe_result":
        log(`  ${C.dim}probe_result id=${m.id} ok=${m.ok} status=${m.status}${C.rst}`);
        break;

      default:
        log(`${C.dim}${m.t}${C.rst}`, JSON.stringify(m).slice(0, 120));
    }
  });
});

process.on("SIGINT", () => { log("\nbye"); process.exit(0); });
