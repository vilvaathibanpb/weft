# Weft — Architecture

Detailed design behind `PLAN.md`. Covers the transport rationale, the extension internals,
the core, the MCP delivery across the clients, the wire protocol, and the data model.

> **Status (what actually shipped).** This document is the original design; the implementation
> has since converged on it with a few deliberate differences — read it alongside the
> [README](../README.md) and [SECURITY.md](../SECURITY.md), which describe the running system:
>
> - The app is a **cross-platform Tauri app** (Rust core + React UI) for macOS/Windows/Linux, not
>   a macOS-only menu-bar app. References to "menu-bar" and "macOS Keychain" below are historical;
>   the token is generated at startup and written to a per-OS `runtime.json`.
> - The **MCP surface is JSON-RPC 2.0** over the loopback control socket (`127.0.0.1:8788`), which
>   `mcp-shim` bridges to each AI client's stdio — implemented directly, no external MCP SDK.
> - Supported clients are **Claude Code, Claude Desktop, Codex, and Cursor** (`scripts/weft-install.mjs`).
> - Token enforcement is live on the **MCP socket**; the extension WS link's token check is still
>   a no-op (tracked in SECURITY.md's "known limitations").

---

## 1. Transport rationale: loopback WebSocket vs Native Messaging

| | Loopback WebSocket (chosen) | Native Messaging |
|---|---|---|
| Host lifecycle | App owns it; always-on menu-bar process | Chrome spawns host per connection; dies with Chrome |
| Multi-tab / multi-profile | One server serves all | One host instance per connecting extension |
| Debuggability | Trivial (any WS client) | Awkward (stdio framed messages) |
| Setup | Install app; pair with token | Install native-messaging manifest into Chrome's config dir |
| Auth burden | **We must add it** (pairing token) | Implicit (Chrome-spawned) |
| Network exposure | **Must bind loopback only** | None (stdio) |

A menu-bar app is a long-lived daemon; Native Messaging's "Chrome spawns and owns the host"
model fights that directly. WebSocket's two downsides (auth + binding) are solved once, in the
core, and bought with far simpler lifecycle and testing. **Decision: loopback WebSocket.**

### Pairing / auth
1. Menu-bar app generates a random token, stores it in **macOS Keychain**, displays a 6-digit
   pairing code (maps to the token) in the UI.
2. User enters the code in the extension popup once; extension stores the token in
   `chrome.storage.local`.
3. Every WS connection sends `Authorization: Bearer <token>` in the first frame; the core drops
   connections that don't authenticate within 1s.
4. Token rotation from the app invalidates old connections.

The core binds **only** to `127.0.0.1` on a fixed-or-discovered port (written to a file in the
app's container that the extension reads via the pairing step).

---

## 2. Chrome extension (MV3)

```
extension/
  manifest.json          # permissions: cookies, debugger, storage, tabs, scripting,
                         #              host_permissions per enabled origin (added dynamically)
  src/background/        # service worker: WS client, chrome.cookies, chrome.debugger session
  src/content/           # reads localStorage/sessionStorage; executes page-context replays
  src/devtools/          # optional richer network view when devtools is open
  src/popup/             # enable/disable per origin, pairing, connection status
```

Key points:
- **Dynamic host permissions:** request `host_permissions` for an origin only when the user
  enables capture there (`chrome.permissions.request`). Keeps the extension least-privilege.
- **Service-worker lifecycle:** MV3 workers are killed when idle. Keep the WS connection
  resilient: reconnect on wake, buffer unsent events, use `chrome.alarms` to nudge if needed.
  Treat the core as the source of truth; the worker is a thin forwarder.
- **Network capture:** attach `chrome.debugger` to the active tab on enable, subscribe to
  `Network.requestWillBeSent` / `Network.responseReceived` / `Network.loadingFinished`, and
  forward method + URL + status only (no headers or bodies — data minimisation). Detach on
  disable.
- **Replays:** background receives a `replay` command → tells the content script to run
  `fetch()` in the page so cookies/same-origin headers apply → returns status + body.

---

## 3. Core sidecar (`core/`, Node + TypeScript)

```
core/
  src/ws/            # authed WebSocket server (ingest events, dispatch commands)
  src/model/         # endpoint dedup + schema inference, per-origin store
  src/openapi/       # synthesize OpenAPI 3.1 from observed samples
  src/mcp/           # MCP server (tool implementations) + transports (stdio, SSE)
  src/store/         # SQLite persistence (better-sqlite3)
  src/redact/        # credential detection + redaction policy
```

- Spawned and supervised by the Swift app as a child process; logs to the app.
- Holds the authoritative in-memory model, mirrored to SQLite so restarts keep history.
- Exposes the MCP surface two ways (see §4).

### Endpoint model
An **endpoint** = `(origin, method, path-template)` where `path-template` collapses variable
segments (numeric IDs, UUIDs) into params, e.g. `/api/users/{id}`. For each endpoint we keep:
- query-param set, request-body JSON schema (merged across samples), response JSON schema,
  status codes seen, auth signals (which cookie/header/token was present), sample count,
  last-seen, and a few redacted example payloads.

Schema inference merges N samples into a permissive JSON Schema (optional vs required inferred
from presence frequency).

---

## 4. MCP delivery across three clients

Problem: the core is already a running daemon, but MCP clients expect to **spawn** their server
over stdio. Solution: a tiny **stdio shim**.

```
AI client ──spawn──▶ mcp-shim (stdio)  ──local socket──▶  core (running in menu-bar app)
```

- `mcp-shim/` is a minimal Node binary. Each client is configured to spawn it. It does nothing
  but forward MCP JSON-RPC between the client's stdio and the core's local control socket
  (Unix domain socket in the app container, or the same loopback port).
- The core implements all tools once; every client shares the same model and session state.
- The core **also** exposes an **HTTP/SSE** MCP endpoint for clients that prefer URLs.

### Client registration

**Claude Code** (`.mcp.json` in a project, or `claude mcp add`):
```json
{ "mcpServers": { "web-to-mcp": { "command": "web-to-mcp-shim" } } }
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{ "mcpServers": { "web-to-mcp": { "command": "/Applications/web-to-mcp.app/Contents/Resources/mcp-shim" } } }
```

**Codex** (`~/.codex/config.toml` MCP section):
```toml
[mcp_servers.web-to-mcp]
command = "/Applications/web-to-mcp.app/Contents/Resources/mcp-shim"
```

The menu-bar app offers a one-click "Install for Claude Code / Desktop / Codex" that writes
these entries, so the paths stay correct after updates.

---

## 5. Wire protocol (extension ↔ core)

JSON messages over WS, shared types in `shared/`. Sketch:

```ts
// extension → core
type Ingest =
  | { t: "hello"; token: string; browser: string; profile: string }
  | { t: "site_enabled"; origin: string }
  | { t: "cookies"; origin: string; cookies: Cookie[] }          // values may be pre-redacted
  | { t: "storage"; origin: string; local: KV[]; session: KV[] }
  | { t: "request"; origin: string; req: CapturedRequest; res: CapturedResponse }
  | { t: "replay_result"; id: string; status: number; headers: KV[]; body?: string };

// core → extension
type Command =
  | { t: "replay"; id: string; origin: string; method: string; path: string;
      query?: KV[]; headers?: KV[]; body?: string }
  | { t: "config"; redact: boolean; captureBodies: boolean };
```

`id` correlates `replay` ↔ `replay_result`. The core never trusts the extension's `origin`
claim beyond what the enabled-origin list allows.

---

## 6. macOS app (`macapp/`, SwiftUI)

- `MenuBarExtra` status item: connection state, active origins, "pair extension",
  per-site consent toggles, audit log, quit.
- Launches/supervises the bundled Node core (`Contents/Resources/core`) via `Process`.
- Owns **Keychain** reads/writes for the pairing token and any at-rest credential values.
- Ships the `mcp-shim` binary in `Contents/Resources` and writes client configs on request.
- Packaging: code-sign + notarize; the embedded Node is a `pkg`/`sea` single binary to avoid a
  runtime dependency.

**Faster alternative:** skip Swift and build the whole shell in **Electron** (menu-bar via
`Tray`). Loses native Keychain ergonomics and adds bundle size, but the entire stack becomes
one TypeScript codebase. Revisit if the Swift shell slows Phase 1.

---

## 7. Risks

- **MV3 service-worker eviction** dropping the WS — mitigated by reconnect + core-side buffering.
- **`chrome.debugger` banner** may annoy users — document it; offer webRequest-only "light mode".
- **Schema inference quality** from sparse samples — start permissive, improve with sample count.
- **Credential handling** is the whole ballgame — redaction-by-default, Keychain, loopback,
  consent gates, audit log. Treat any regression here as a release blocker.
