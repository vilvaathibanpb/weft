# Show HN kit

You have to post this yourself — HN submissions have to come from you, from your account, and
that's both the rule and the right thing. Everything below is ready to paste. Don't post from a
fresh account or ask anyone to upvote; HN detects both and it backfires.

---

## Title

Keep it under 80 chars, no hype, no trailing period.

```
Show HN: Weft – Any website you're logged into, as a local MCP server
```

Alternates:
- `Show HN: Weft – Turn a website you're logged into into a local MCP server`
- `Show HN: Weft – Give your AI the APIs behind sites you're already logged into`

## URL

Submit the **repo** as the link: `https://github.com/vilvaathibanpb/weft`
(HN prefers the thing itself over a blog post. Put the blog link in your first comment.)

---

## First comment (post this immediately after submitting)

> Author here. I kept hitting the same wall: a tool I use has no API I can give my AI assistant,
> but it has a web app I'm already logged into that's clearly talking to a JSON API. My "solution"
> was DevTools → Copy as fetch → wrap it in a script, over and over, re-doing it every time the
> site shipped.
>
> Weft automates that. One button in a Chrome extension captures a site's API traffic from your
> own session; a local desktop app (Rust core, Tauri UI) turns it into a deduped, path-templated
> endpoint model and serves it to Claude Code / Cursor / Codex / Claude Desktop over MCP. The
> clever bit is replay: when the AI calls an endpoint, the request runs *in the browser page*, so
> your session cookies attach themselves — the app never holds your tokens.
>
> Deliberate constraints, since it touches an authenticated session:
> - Credential values never leave the browser (names/keys only).
> - Writes (non-GET) are refused unless the caller passes confirm:true.
> - Loopback only, token-gated, no account, no telemetry.
>
> What it can't do: it won't defeat CAPTCHAs, signed requests, or device-bound sessions — it flags
> those sites "not possible" instead of pretending. And automating a logged-in session can violate
> a site's ToS; that judgment is yours. It's young — body-schema inference and persistence are
> partial — but capture, the MCP server, and live replay work and are tested end-to-end.
>
> It's MIT. I'd love site reports, especially sites that captured something they shouldn't, or got
> wrongly flagged. Writeup with the architecture: [blog link]

---

## Replies to prep (likely questions)

**"Isn't this just a ToS violation machine?"**
It can be used that way, and I'm not going to pretend otherwise. It doesn't break any technical
protection — no CAPTCHA solving, no anti-bot evasion. It does for your AI what you can already do
by hand in DevTools on sites you have legitimate access to. You own the call on where that's
appropriate, same as any scraping or automation tool.

**"How is this different from Playwright MCP / browser-use / computer-use?"**
Those drive the *UI* — they click and read the page. Weft targets the *API underneath* the page,
so the AI gets structured JSON and an OpenAPI spec, not screen-scraped text, and calls are a round
trip instead of a browser session per action. Different layer, different cost profile.

**"Why not just use the official MCP for X?"**
Use it if it exists — it'll be more robust. Weft is for the long tail with no first-party
integration: internal tools, niche SaaS, regional apps.

**"Security — you're reading my cookies."**
Values never cross the wire; the app only ever sees names/keys. Replays happen in the browser, not
the app, so tokens stay in the browser. Everything's on 127.0.0.1 with a per-run token. The code is
open — the relevant files are the extension's snapshot path and the core's `get_auth_context`,
which is names-only by construction. Please do read them.

**"Does it work on <site>?"**
Maybe — depends whether the site exposes a JSON/XHR API and whether requests are replayable. Try it
and file a site report; that data is the most useful contribution right now.

**"Electron?"**
Tauri. Rust core, small bundles, the capture/model/MCP logic is all in one crate with tests.

---

## Timing

- Best windows: Tue–Thu, ~8–10am US Eastern (when HN is active but not yet flooded).
- Post the submission, then the first comment within a minute.
- Be around for the next 2–3 hours to reply. Engaged authors do far better than drive-by posts.
- Don't editorialize the title, don't ask for upvotes, don't post from an alt. If it doesn't catch
  the first time, a second Show HN weeks later with real changes is allowed.
```
