# Demo media — how to record them

Two assets make the launch land: a short **product GIF** for the README top, and a 60–90s
**explainer video** for the blog/HN. The terminal GIF can be auto-generated; the app walkthrough
you record once. Keep them honest — show the real thing.

Place finished files here:

- `weft-demo.gif` — the hero GIF referenced by the README (the app walkthrough, trimmed to ~12s).
- `weft-mcp-demo.gif` — the auto-generated terminal/MCP GIF (optional second asset).
- `explainer.mp4` — the 60–90s narrated video for the blog post.

---

## 1. Terminal/MCP GIF (auto-generated — real core, no browser needed)

```bash
# install the recorder once
brew install vhs

# terminal A: start the seeded core (real WS + MCP servers)
cd crates/weft-core && cargo run --bin weft-demo-core

# terminal B: render the GIF
vhs tools/demo/weft.tape          # → docs/media/weft-mcp-demo.gif
```

This shows an AI client listing endpoints, getting a synthesized OpenAPI spec, reading the auth
context (names only), and hitting the write **consent gate** — all against the real core.

---

## 2. App walkthrough GIF + explainer video (you record)

The compelling demo is the real loop: a site → one click → your AI using it. Record it once.

**Tools:** macOS screen recording (⌘⇧5) or [Kap](https://getkap.co) for a clean crop; export the
app-walkthrough clip to GIF (≤12s, ≤8 MB) for the README, and keep the full narrated take as MP4.

**Setup before you hit record**
- `npm run tauri dev` (app running), extension loaded, dark mode, window ~1040×680.
- Be logged into a site with an obvious JSON API — Linear, Notion, or GitHub work well.
- Have Claude Code (or Cursor) open in a second window, already wired: `node scripts/weft-install.mjs claude-code`.

**Shot list (storyboard)**

| # | On screen | ~sec | Narration (for the video) |
|---|-----------|------|---------------------------|
| 1 | The site, logged in | 0–6 | "This is a tool I use every day. It has a web app, but no API I can give my assistant." |
| 2 | Click the Weft extension → **Convert this site to MCP**, approve the permission | 6–14 | "One click. Weft rides the session I already have — no API keys, no OAuth." |
| 3 | Browse the site; cut to the Weft app, the site appears and endpoints stream in | 14–26 | "It watches the site's own API traffic and maps it — paths, methods, deduped and templated." |
| 4 | Weft app: open the site, show the endpoint list + status "Ready" | 26–34 | "Everything local. Values never leave the browser." |
| 5 | Claude Code: "list my open issues" → it calls `call_endpoint` → real data returns | 34–50 | "Now my assistant can actually use it — through my live session, on my machine." |
| 6 | Claude Code: ask it to create something → consent gate / confirm | 50–62 | "Writes don't fire silently — they need explicit confirmation." |
| 7 | Weft app library with a few sites; end card: name + repo URL | 62–75 | "Weft. Any website you're logged into, as an MCP server. Open source — link below." |

**Make the GIF (from the app-walkthrough clip)**

```bash
# trim + scale + palette for a crisp, small GIF (needs ffmpeg)
ffmpeg -i app-walkthrough.mov -vf "fps=15,scale=1000:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i app-walkthrough.mov -i palette.png -lavfi "fps=15,scale=1000:-1:flags=lanczos[x];[x][1:v]paletteuse" weft-demo.gif
```

**Tips:** no real tokens on screen; blur anything sensitive; keep it under ~12s and loop-friendly;
record at 2× then scale down for sharpness.
