# Contributing to Weft

Thanks for considering a contribution. Weft is a small, focused tool, and we'd like to keep it
that way — clean, honest about its limits, and pleasant to hack on.

## Ways to help

- **Site reports.** The most useful contribution is often data: a site that captures well, or one
  that should be `not_possible` but isn't (or vice versa). Open an issue with the site and what
  you saw — no credentials, please.
- **Bug fixes and features.** See the open issues, especially anything tagged `good first issue`.
- **Docs.** If something in the README or setup tripped you up, a doc PR is very welcome.

## Project layout

```
crates/weft-core/     Rust core: WS capture, endpoint model, OpenAPI synth, MCP server, replay bridge
apps/desktop/         Tauri + React desktop app (embeds weft-core)
extension/            MV3 Chrome extension — the "Convert this site to MCP" button
mcp-shim/             Tiny Node stdio↔core bridge each AI client spawns
packages/protocol/    Shared TypeScript types (mirror the Rust serde shapes)
scripts/              weft-install.mjs and friends
tools/                Standalone dev tooling (dev core, icon/license generators)
docs/                 Architecture, plan, monetization notes, brand
```

Data flow:

```
extension ──ws(8787)──▶ weft-core ──▶ endpoint model ──▶ MCP tools
                 ▲            │
                 └── replay ──┘   (AI client ──stdio──▶ mcp-shim ──tcp(8788)──▶ weft-core)
```

## Developing

Prerequisites: **Rust** (stable), **Node 18+**, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
# run the app (starts both loopback servers)
cd apps/desktop && npm run tauri dev
```

Load `extension/` unpacked at `chrome://extensions` (Developer mode → Load unpacked).

### Tests and checks (run these before opening a PR)

```bash
# Rust core — unit + end-to-end MCP integration test
cd crates/weft-core && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check

# Desktop Rust type-check
cd apps/desktop/src-tauri && cargo check

# Frontend
cd apps/desktop && npx tsc --noEmit && npm run build

# Shim + installer smoke
node --check mcp-shim/index.js
node scripts/weft-install.mjs all --shim mcp-shim/index.js --dry-run
```

CI runs the same checks (`.github/workflows/ci.yml`).

## Pull request guidelines

- Keep PRs focused; one logical change per PR.
- Match the surrounding style. Rust is `rustfmt`-clean and `clippy`-clean; TypeScript follows the
  existing files.
- Add or update a test for behavior changes. The core's tests are fast and worth imitating.
- Update docs (`README`, `SECURITY`, protocol types) when behavior or the wire format changes.
- Be honest in copy. If something is partial or a guess, say so — that's a project value.

## Security

Never attach real credentials, cookies, tokens, or capture dumps to issues or PRs. For
vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
