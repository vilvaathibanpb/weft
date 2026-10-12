#!/usr/bin/env node
/**
 * A scripted MCP session against a running Weft core — the same JSON-RPC the shim forwards from
 * a real AI client, printed nicely for a terminal demo/GIF. Start the core first:
 *
 *   cargo run --bin weft-demo-core      # in crates/weft-core
 *   node tools/demo/mcp-demo.mjs
 *
 * Everything here is the real core doing real work on real captured endpoints. No mocks.
 */
import net from "node:net";
import readline from "node:readline";

const PORT = Number(process.env.WEFT_MCP_PORT || 8788);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", c: "\x1b[36m", y: "\x1b[33m", r: "\x1b[0m" };

const sock = net.createConnection({ host: "127.0.0.1", port: PORT });
const pending = new Map();
let seq = 1;

readline.createInterface({ input: sock }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const r = pending.get(msg.id);
  if (r) { pending.delete(msg.id); r(msg); }
});

function rpc(method, params) {
  const id = seq++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    sock.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function call(name, args, { ask }) {
  console.log(`\n${C.dim}you ▸${C.r} ${C.b}${ask}${C.r}`);
  await sleep(500);
  console.log(`${C.c}  → weft.${name}(${JSON.stringify(args)})${C.r}`);
  const res = await rpc("tools/call", { name, arguments: args });
  const payload = res.result?.content?.[0]?.text ?? JSON.stringify(res.error);
  const isErr = res.result?.isError;
  const tag = isErr ? `${C.y}  ⚠ consent gate${C.r}` : `${C.g}  ✓${C.r}`;
  console.log(tag);
  console.log(payload.split("\n").map((l) => "    " + l).join("\n"));
  await sleep(1100);
}

sock.on("connect", async () => {
  // Handshake, exactly as mcp-shim does.
  sock.write(JSON.stringify({ t: "shim_hello", token: "" }) + "\n");
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", clientInfo: { name: "demo" } });
  console.log(`${C.dim}connected to ${init.result.serverInfo.name} v${init.result.serverInfo.version} — MCP ${init.result.protocolVersion}${C.r}`);
  await sleep(700);

  await call("list_sites", {}, { ask: "what sites can you reach?" });
  await call("list_endpoints", { site: "app-linear-app" }, { ask: "what endpoints does Linear expose?" });
  await call("search_endpoints", { query: "issues" }, { ask: "find anything about issues" });
  await call("get_openapi", { site: "app-linear-app" }, { ask: "give me an OpenAPI spec for it" });
  await call("get_auth_context", { site: "app-linear-app" }, { ask: "what auth does it use?" });
  await call("call_endpoint", { site: "app-linear-app", method: "POST", path: "/api/issues", body: "{}" },
    { ask: "create a new issue" }); // refused: writes need confirm:true

  console.log(`\n${C.dim}(a GET call_endpoint replays live through the browser session; see the app demo.)${C.r}\n`);
  sock.end();
  process.exit(0);
});

sock.on("error", (e) => {
  console.error(`\n  could not reach the Weft core on 127.0.0.1:${PORT} — start it first:\n    cd crates/weft-core && cargo run --bin weft-demo-core\n  (${e.message})`);
  process.exit(1);
});
