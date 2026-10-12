# weft-mcp-shim

A ~80-line stdio proxy. Each AI client spawns it; it forwards MCP JSON-RPC to the running Weft
app over a loopback socket, so all clients share one endpoint model and one session state.

## Register

**Claude Code**
```bash
claude mcp add weft -- node /absolute/path/to/weft/mcp-shim/index.js
```

**Claude Desktop** — `claude_desktop_config.json`
```json
{ "mcpServers": { "weft": { "command": "node", "args": ["/absolute/path/to/weft/mcp-shim/index.js"] } } }
```

**Codex** — `~/.codex/config.toml`
```toml
[mcp_servers.weft]
command = "node"
args = ["/absolute/path/to/weft/mcp-shim/index.js"]
```

> The desktop app's **Clients** screen writes these entries for you (one click), so the path
> stays correct across updates.

## How it finds the core
Reads the app's `runtime.json` (per-OS app-data dir) for the MCP control port and pairing token.
If the core isn't running, it returns a clear MCP error instead of hanging.
