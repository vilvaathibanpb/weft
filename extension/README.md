# Weft extension — load &amp; test

One button: **Convert this site to MCP**. It snapshots your session (cookie *names*, storage
keys) and captures the site's live API traffic, streaming it to the local Weft core.

The **Weft desktop app is now the WS endpoint** — it listens on `ws://127.0.0.1:8787` and builds
the real endpoint model as you browse.

## 1. Start the Weft app (the WS endpoint)
```bash
cd apps/desktop
npm install        # once
npm run tauri dev  # logs: [weft] ws core listening on ws://127.0.0.1:8787
```
Converted sites appear in the app's **Library** and fill with endpoints live as you browse.

> Prefer to watch raw messages in a terminal instead? The Node **dev core** still works as a
> drop-in alternative: `cd tools/devcore && npm install && node server.mjs`. Run only one of the
> two at a time — they both bind port 8787.

## 2. Load the extension
```
chrome://extensions  →  enable Developer mode  →  Load unpacked  →  select the  extension/  folder
```
(Icons are already generated. If you ever need to regenerate: `node tools/icons/gen.mjs`.)

## 3. Convert a site
1. Open a site you're **logged into** (Linear, GitHub, Gmail…).
2. Click the **Weft** toolbar icon → **Convert this site to MCP**.
3. Approve the one-time **site permission** prompt.
4. Chrome shows an **"extension is debugging this browser"** banner — that's expected; it's how
   Weft reads full request/response bodies. Leave it; don't click "Cancel".
5. **Browse the site normally.** Watch the dev-core terminal — you'll see the session snapshot and
   a live, deduped endpoint list (numeric/UUID path segments collapse to `{id}`/`{uuid}`):

```
▶ convert https://app.linear.app
  cookies: 7 (names only) — session, csrf, …
  endpoint GET    /api/issues        → 200 (1 unique so far)
  endpoint GET    /api/issues/{id}   → 200 (2 unique so far)
  endpoint POST   /api/issues        → 201 (3 unique so far)
```

## What's a good test
- A site with an obvious JSON/XHR API (Linear, Notion, GitHub) → endpoints stream in quickly.
- A heavily server-rendered site → few/no endpoints (this is what the real app flags as
  "Not possible").

## Notes
- Loopback only (`ws://127.0.0.1:8787`); nothing leaves your machine.
- Cookie/storage **values** are not sent (names/keys only) in this first cut.
- To stop capturing: close the tab, or disable the extension.
- Known first-cut limits: no reconnection backoff tuning, binary/streaming bodies are skipped,
  and the token handshake is a no-op in dev (the real core enforces it).
