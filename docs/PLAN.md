# web-to-mcp — Plan (v2)

Convert any site you're logged into — in your own browser — into a local MCP server your
AI assistant (Claude Code / Claude Desktop / Codex) can query. A **cross-platform desktop app**
is the product; the **browser extension is one button**: "Convert this site to MCP."

Everything runs locally. Captured data and credentials never leave the machine.

> v1 (menu-bar-only, Swift) is superseded by this. See `ARCHITECTURE.md` (needs a matching
> refresh) and `MONETIZATION.md`.

---

## 1. The pivot

| | v1 | **v2 (this)** |
|---|---|---|
| Center of gravity | Menu-bar app | **Full desktop app** (manager) |
| Platforms | macOS only | **Windows + macOS + Linux** |
| Framework | SwiftUI + Node | **Tauri v2 + React** (Electron fallback) |
| Extension | captures + UI | **one button**: "Convert this site to MCP" |
| MCP state | implicit | **explicit lifecycle**: Ready / Outdated / Needs-login / Not-possible |
| Refresh | n/a | **opens the browser, re-syncs the session** |
| Business | — | **one-time purchase**, offline license (see `MONETIZATION.md`) |

**Why Tauri:** cross-platform, ~10MB bundles, Rust backend suited to the local server, process
spawning, OS keychain, and launching the browser. Electron is the fallback only if we'd rather
reuse the TypeScript MCP SDK directly.

---

## 2. The two surfaces

### Browser extension (minimal)
- A single action: **"Convert this site to MCP"** on the current origin.
- On click: requests host permission, grabs the session (cookies + storage), attaches the
  debugger to sample live API traffic, and streams it to the desktop app over the authed
  loopback channel. Then it gets out of the way.
- Also the **capture agent for refreshes**: when the app says "refresh origin X", the extension
  opens/focuses that tab and re-syncs the session.

### Desktop app (the product)
A full, manageable library of your MCPs:
- **MCP list** with live status per site (see §3).
- **Convert / Re-capture / Refresh / Pause / Delete** actions.
- **Install into clients** (Claude Code / Desktop / Codex) with one click.
- **Audit log**, consent toggles, per-site method allowlist.
- **Account & plan** (free vs pro).

---

## 3. MCP lifecycle (the heart of v2)

Each converted site is an "MCP" with one of these states:

| State | Meaning | Primary action |
|---|---|---|
| **Capturing** | Just converted; sampling traffic | (auto) |
| **Ready / Live** | API mapped, session valid, served to clients | Open in client |
| **Outdated** | Schema drift — new/changed endpoints seen | **Re-capture** |
| **Needs login** | Session probe returned 401/403 | **Refresh** → opens browser to log in |
| **Refreshing** | Browser open, re-syncing session | (transient) |
| **Not possible** | Replays won't work — with a reason (see §4) | Why? / Retry |
| **Paused** | User disabled it | Resume |

**How states are detected**
- **Needs login:** the app periodically (and on-demand) runs a lightweight probe — a replay of a
  known safe `GET` — through the extension. `401/403` ⇒ Needs login.
- **Outdated:** live sampled requests are compared to the stored model; new endpoints or changed
  shapes ⇒ Outdated (with a diff).
- **Refresh flow:** app → extension opens the site tab → user logs in if needed → probe succeeds
  → back to Ready. The app **never** tries to mint or refresh tokens itself; it re-syncs the
  real browser session.

---

## 4. "Can this site become an MCP?" (the Not-possible check)

After capture, the core analyzes traffic and marks **Not possible** with a plain reason when
replay can't work:

- **Per-request signing** — HMAC signatures, nonces, or timestamps bound to each call; a replayed
  request is rejected. *(most common blocker)*
- **Device/fingerprint binding** — anti-bot headers tied to the live page or a JS challenge.
- **No replayable API** — content is server-rendered HTML with no XHR/fetch JSON to expose.
- **Non-replayable transport** — data arrives only over WebSocket/gRPC-web/SSE.
- **DRM / hard obfuscation.**

Partial cases degrade instead of failing: if the debugger is declined, we fall back to
header-only "light mode" and mark schemas `partial`.

---

## 5. Architecture (v2 shape)

```
┌──────────────────┐   authed loopback   ┌──────────────────────────────┐   stdio/SSE   ┌────────────┐
│ Extension        │ ──(ws 127.0.0.1)──▶ │ Desktop app (Tauri)          │ ◀──(MCP)───── │ Claude Code│
│ [Convert] button │ ◀── refresh cmds ── │  • Rust core: WS, model,     │               │ Claude Desk│
│ capture agent    │                     │    OpenAPI, probe, SQLite    │               │ Codex      │
└──────────────────┘                     │  • React UI: MCP library     │               └────────────┘
                                         │  • OS keychain, consent      │   (each client spawns a
                                         │  • serves MCP + spawns shim  │    tiny stdio shim → core)
                                         └──────────────────────────────┘
```

- The **core lives inside the app** (not a separate daemon). In Tauri it's Rust (axum/tokio +
  the `rmcp` MCP crate); in the Electron fallback it's the Node core from v1.
- Each AI client spawns a thin **stdio shim** that proxies JSON-RPC to the running app — so all
  clients share one model and one session state.
- Transport, auth, redaction, and consent carry over from v1 (see `ARCHITECTURE.md`): loopback
  only, paired token in the OS keychain, credential values redacted by default, write-method
  guardrails, audit log.

---

## 6. MCP tools (unchanged core + management)

`list_sites`, `list_endpoints`, `get_endpoint`, `search_endpoints`, `get_openapi`,
`get_auth_context` (redacted by default), `call_endpoint` (consent-gated), `recent_requests`
— plus the app exposes `status` per MCP so a client can tell Ready from Needs-login.

---

## 7. Phases

- **P0 — Scaffold.** Tauri app, React shell, Rust core skeleton, shared protocol, extension stub.
- **P1 — Convert + see it.** Extension button → capture → app shows one MCP reaching **Ready**.
- **P2 — Model + OpenAPI + Not-possible check.** Endpoint model, schema inference, synthesis,
  convertibility analysis with reasons.
- **P3 — MCP serving + client install.** stdio shim; one-click install for all three clients.
- **P4 — Lifecycle.** Probe loop, Needs-login/Outdated detection, **Refresh-opens-browser** flow.
- **P5 — Replays + consent + keychain + audit.**
- **P6 — Licensing.** 14-day free trial + offline Ed25519 license key (no account, no server).
- **P7 — Polish + packaging.** Signing/notarization (mac), MSIX/Authenticode (win), auto-update.

---

## 8. Legal / risk (affects product + business)

Automating authenticated access to third-party sites can conflict with their ToS, and some sites
actively block it. Position and build accordingly: **your own session, your own data, local-only,
user-initiated.** This shapes what a "recipe marketplace" can safely offer (see `MONETIZATION.md`
§ risks) — avoid shipping credentials or scraping-as-a-service for sites that forbid it.
