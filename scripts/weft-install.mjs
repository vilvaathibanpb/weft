#!/usr/bin/env node
/**
 * weft-install — register Weft's MCP server with your AI client(s).
 *
 * Every client launches the same tiny stdio shim (mcp-shim/index.js); the shim bridges to the
 * running Weft app. This script writes (or removes) that one entry in each client's own config
 * file, non-destructively — it reads what's there, changes only the `weft` server, writes it back.
 *
 *   node scripts/weft-install.mjs <target> [--shim <path>] [--uninstall] [--dry-run]
 *
 *   target: claude-code | claude-desktop | codex | cursor | all
 *
 * No network, no telemetry. Prints exactly which file it touched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, "AppData", "Roaming");
const XDG = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");

const CLIENTS = ["claude-code", "claude-desktop", "codex", "cursor"];

function usage(msg) {
  if (msg) console.error(`\n  error: ${msg}`);
  console.error(`
  weft-install — add Weft to your AI client's MCP config

  usage:
    node scripts/weft-install.mjs <target> [options]

  target:
    claude-code | claude-desktop | codex | cursor | all

  options:
    --shim <path>   path to mcp-shim/index.js (default: alongside this repo)
    --uninstall     remove the weft entry instead of adding it
    --dry-run       print what would change, write nothing
`);
  process.exit(msg ? 1 : 0);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) usage();

const target = argv[0];
const uninstall = argv.includes("--uninstall");
const dryRun = argv.includes("--dry-run");
const shimFlag = argv.indexOf("--shim");
const shimPath = shimFlag >= 0
  ? path.resolve(argv[shimFlag + 1])
  : path.resolve(__dirname, "..", "mcp-shim", "index.js");

if (![...CLIENTS, "all"].includes(target)) usage(`unknown target "${target}"`);
if (!uninstall && !fs.existsSync(shimPath)) {
  usage(`shim not found at ${shimPath} — pass --shim <path to mcp-shim/index.js>`);
}

/** The MCP server entry every JSON-based client uses. */
function serverEntry() {
  return { command: process.execPath, args: [shimPath] };
}

function configFor(client) {
  switch (client) {
    case "claude-code":
      // Claude Code keeps user-scope MCP servers in ~/.claude.json under "mcpServers".
      return { file: path.join(HOME, ".claude.json"), format: "json", key: "mcpServers" };
    case "claude-desktop":
      return {
        file: process.platform === "win32"
          ? path.join(APPDATA, "Claude", "claude_desktop_config.json")
          : process.platform === "darwin"
            ? path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
            : path.join(XDG, "Claude", "claude_desktop_config.json"),
        format: "json", key: "mcpServers",
      };
    case "cursor":
      return { file: path.join(HOME, ".cursor", "mcp.json"), format: "json", key: "mcpServers" };
    case "codex":
      return { file: path.join(HOME, ".codex", "config.toml"), format: "toml", key: "mcp_servers" };
    default:
      throw new Error(`no config mapping for ${client}`);
  }
}

function applyJson(cfg) {
  let doc = {};
  if (fs.existsSync(cfg.file)) {
    try {
      doc = JSON.parse(fs.readFileSync(cfg.file, "utf8") || "{}");
    } catch (e) {
      throw new Error(`existing ${cfg.file} is not valid JSON (${e.message}) — fix or move it first`);
    }
  }
  doc[cfg.key] = doc[cfg.key] || {};
  if (uninstall) {
    delete doc[cfg.key].weft;
  } else {
    doc[cfg.key].weft = serverEntry();
  }
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Codex uses TOML. We avoid a TOML dependency by editing just the `[mcp_servers.weft]` block:
 * drop any existing one, then append a fresh block unless uninstalling.
 */
function applyToml() {
  const cfg = configFor("codex");
  let text = fs.existsSync(cfg.file) ? fs.readFileSync(cfg.file, "utf8") : "";
  // Remove an existing [mcp_servers.weft] block (from its header to the next header or EOF).
  text = text.replace(/(^|\n)\[mcp_servers\.weft\][^\n]*\n(?:(?!\n?\[)[^\n]*\n?)*/g, "$1").replace(/\n{3,}/g, "\n\n");
  if (!uninstall) {
    const argsToml = JSON.stringify([shimPath]);
    const block = `\n[mcp_servers.weft]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${argsToml}\n`;
    text = text.replace(/\s*$/, "\n") + block;
  }
  return { cfg, text: text.replace(/^\n+/, "") };
}

function write(file, content) {
  if (dryRun) {
    console.log(`  [dry-run] would write ${file}:\n`);
    console.log(content.split("\n").map((l) => "    " + l).join("\n"));
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function doClient(client) {
  const cfg = configFor(client);
  const verb = uninstall ? "removed from" : "added to";
  if (cfg.format === "json") {
    write(cfg.file, applyJson(cfg));
  } else {
    const { cfg: tc, text } = applyToml();
    write(tc.file, text);
  }
  console.log(`  ✓ weft ${verb} ${client}  (${cfg.file})`);
}

const targets = target === "all" ? CLIENTS : [target];
console.log(`\n  shim: ${shimPath}`);
for (const c of targets) {
  try {
    doClient(c);
  } catch (e) {
    console.error(`  ✗ ${c}: ${e.message}`);
  }
}
if (!uninstall && !dryRun) {
  console.log(`\n  Restart the client, then ask it to "list weft sites". Open the Weft app first.\n`);
}
