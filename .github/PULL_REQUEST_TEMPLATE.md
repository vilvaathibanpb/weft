<!-- Thanks for the PR! Keep it focused; one logical change. -->

## What and why

<!-- What does this change, and what problem does it solve? Link any issue (#123). -->

## How I tested it

<!-- Commands you ran. For core changes, the relevant cargo tests. -->

- [ ] `cd crates/weft-core && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
- [ ] `cd apps/desktop && npx tsc --noEmit && npm run build` (if frontend touched)
- [ ] `cargo check` in `apps/desktop/src-tauri` (if desktop Rust touched)

## Checklist

- [ ] No real credentials, cookies, tokens, or capture dumps anywhere in this PR
- [ ] Tests added/updated for behavior changes
- [ ] Docs / protocol types updated if the wire format or behavior changed
- [ ] Copy is honest about anything partial or best-effort
