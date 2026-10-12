# Security

Weft turns a website you're already logged into in your own browser into a local MCP server that
your AI tools can query. That means it handles a live, authenticated session. We take that
seriously, and we want you to understand exactly what it does and doesn't do before you trust it.

## Threat model in one paragraph

Weft runs entirely on your machine. The browser extension captures the API traffic of sites you
explicitly convert and talks to a desktop app over a loopback WebSocket (`127.0.0.1:8787`). The
app exposes an MCP server over a second loopback socket (`127.0.0.1:8788`) that your AI client
reaches through a small stdio shim. Nothing is sent to us or to any third party. There is no
account, no cloud, no telemetry.

## What Weft does with your credentials

- **Cookie and storage _values_ are never sent over the wire.** The extension reports cookie
  **names** and storage **keys** only (so an AI can reason about auth), never their values. See
  `get_auth_context` — it is names/keys only by construction.
- **Replays run in your browser, not in the app.** When an AI calls `call_endpoint`, the request
  is executed by the extension inside the live page, where the session cookies attach themselves.
  The app never holds your session tokens.
- **Writes require explicit consent.** Any non-`GET` replay is refused unless the caller passes
  `confirm: true`. An AI cannot silently POST/PUT/PATCH/DELETE on your behalf.
- **Loopback only.** Both sockets bind `127.0.0.1`. The MCP socket additionally requires a random
  per-run token (written to `runtime.json` in your app-data dir) that the shim must present.

## What you are responsible for

- **Site terms of service.** Automating an authenticated session may violate a site's ToS. You
  decide which sites are appropriate. Weft does not bypass CAPTCHAs, bot-detection, or DRM, and
  it flags sites it cannot replay (`not_possible`) rather than trying to defeat protections.
- **What your AI does with access.** Treat a converted site like giving your AI an API key to it.
  Convert only what you need, and pause or delete MCPs you aren't using.

## Known limitations (first cut)

- The WS (extension) link does not yet enforce the pairing token; the MCP (shim) link does.
- Binary/streaming response bodies are skipped.
- Request/response **bodies** are not persisted into schemas yet, so synthesized OpenAPI asserts
  only paths, methods, query params, and observed status codes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Email the maintainers (see the
repository's GitHub profile) with:

- a description of the issue and its impact,
- steps to reproduce (a minimal repro is ideal),
- any suggested remediation.

We aim to acknowledge within 72 hours and to ship a fix or mitigation as fast as the severity
warrants. Please give us a reasonable window to remediate before any public disclosure. We're
happy to credit you in the release notes if you'd like.
