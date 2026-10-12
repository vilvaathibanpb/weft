---
title: "I turned the websites I'm logged into into MCP servers my AI can call"
published: false
description: "Weft rides the browser session you already have, maps a site's API from real traffic, and serves it to Claude Code, Cursor, Codex and Claude Desktop over MCP. Local-only, open source."
tags: ai, mcp, opensource, rust
cover_image: ""
canonical_url: ""
---

Half the tools I use every day don't have an API I can hand to my AI assistant. Or they have one,
but it's behind an enterprise plan, or it's a pale shadow of what the web app can do, or getting a
token means filing a ticket with IT. Meanwhile the web app itself is sitting right there in my
browser, logged in, talking to a perfectly good JSON API under the hood.

So for a while my workflow was embarrassing: open DevTools, find the request, "Copy as fetch,"
paste it into a scratch file, strip the headers down to what actually matters, and wrap it in a
little script my assistant could call. It works. It's also miserable, and it breaks every time the
site ships.

I got tired of doing it by hand, so I built **Weft**. It's a small desktop app plus a one-button
Chrome extension. You click **Convert this site to MCP**, browse the site for a few seconds, and
the site's API shows up as an [MCP](https://modelcontextprotocol.io) server your AI tools can
query — Claude Code, Cursor, Codex, Claude Desktop. No API keys, no OAuth app, no cloud. It runs
entirely on `localhost`.

It's open source (MIT): **https://github.com/vilvaathibanpb/weft**

## How it actually works

There are three pieces, and the data flow is deliberately boring:

1. **The extension** captures the API traffic of a site you explicitly convert. It uses Chrome's
   debugger protocol to see full requests and responses, and it snapshots your session — but only
   cookie **names** and storage **keys**, never their values.
2. **The desktop app** (Rust core, Tauri UI) folds that traffic into an endpoint model. It
   deduplicates and templates paths, so `/api/issues/42` and
   `/api/issues/8d1f6c2a-…` collapse into `/api/issues/{id}` and `/api/issues/{uuid}`. It can
   synthesize an OpenAPI 3.1 spec from what it observed — and only what it observed; it doesn't
   invent schemas it never saw.
3. **An MCP server** (also local) exposes tools like `list_endpoints`, `get_openapi`,
   `search_endpoints`, and `call_endpoint`. Your AI client reaches it through a tiny stdio shim.

The interesting part is `call_endpoint`. When your assistant calls it, the request isn't replayed
by the app — it's replayed by the extension, *inside the live page*, where your session cookies
attach themselves automatically. The app never holds your tokens. It's the difference between
"give this program your credentials" and "let this program ask your browser to do a thing."

## The part I want to be upfront about

This tool reads an authenticated session. That deserves a straight answer about what it does, so
here it is.

- **Credential values never leave the browser.** The app sees cookie names and storage keys so an
  AI can reason about auth, but not the secrets themselves. The `get_auth_context` tool is
  names-only by construction.
- **Writes require explicit consent.** Any non-`GET` replay is refused unless the caller passes
  `confirm: true`. Your assistant can't quietly POST on your behalf because it misread a prompt.
- **Loopback only, token-gated.** Both sockets bind `127.0.0.1`, and the MCP socket requires a
  random per-run token. There's no account and no telemetry — there's nowhere for your data to go.

And the things it **can't** do, which matter just as much:

- **It respects site terms of service — that's on you.** Automating a logged-in session can
  violate a site's ToS. Weft doesn't bypass CAPTCHAs, bot-detection, or DRM. When a site signs
  every request or binds it to a device fingerprint, Weft can't replay it, and it says so
  (`not_possible`) instead of pretending.
- **It's young.** Body-schema inference, persistence across restarts, and automatic "this site
  can't work" detection are partial or still on the roadmap. The capture path, the MCP server, and
  live replay all work and are covered by tests, including an end-to-end one that drives the real
  servers over real sockets.

## Why bother, when official MCPs exist?

They do, for the big names — GitHub, Linear, Notion — and if a first-party MCP exists for your
tool, use it; it'll be more robust. Weft is for the long tail: the internal admin panel, the niche
SaaS, the regional tool that will never get an official integration but absolutely has an API your
browser is already using. That's where "bring your own session" earns its keep.

## Try it / break it

The most useful thing you can do is point it at a site and tell me what happened — especially if it
captured something it shouldn't have been able to, or flagged a site `not_possible` that should
work. There's a **Site report** issue template for exactly that (no credentials, please).

Repo, docs, and the honest status matrix are here:
**https://github.com/vilvaathibanpb/weft**

If you end up using it for something I didn't expect, I'd genuinely like to hear about it.
