# Weft license tooling

Offline, Ed25519-signed perpetual licenses. **No license server** — the app verifies locally
against a compiled-in public key.

## One-time: generate the signing keypair
```bash
cd tools/license
node keygen.mjs
```
- Writes `keys/private.pem` (**SECRET** — gitignored, never ships) and `keys/public.hex`.
- Copy the printed public hex into **both**:
  - `apps/desktop/src/lib/license.ts` → `PUBLIC_KEY_HEX`
  - `crates/weft-core/src/license.rs` → `PUBLIC_KEY_HEX`

Regenerating (`--force`) invalidates every license already issued.

## Issue a license (per purchase)
```bash
node sign.mjs --name "Ada Lovelace" --edition personal --id order_12345
# → prints the license key to give the customer
```
Run this from the merchant-of-record (Paddle / Lemon Squeezy / Polar) purchase webhook, or by hand.

- `--edition` = `personal` | `team`
- `--major`   = the major version this key is valid for (default `1`). `2.0` = new keys = paid upgrade.

## Verify
The app does it offline. To check by hand, paste a key into **Settings → License** in the app.

## Demo key (for testing the current public key)
This verifies against the committed `PUBLIC_KEY_HEX` (Ada Lovelace, personal, 1.x):
```
eyJuIjoiQWRhIExvdmVsYWNlIiwiZSI6InBlcnNvbmFsIiwibSI6MSwiaXNzIjoiMjAyNi0xMC0wMSIsImlkIjoiZGVtby0wMDAxIn0.fqcsCrNHQqWO5m3w0GDa5FeUy721yLkTUj_iXUJU7p_T6zbunNGFqSPxK_jehwBOZxZLbEVNrsn2YixLLz0qCg
```
> This demo key is valid only for the keypair currently in the repo. When you run `keygen.mjs`
> for production, it stops working — reissue with your own key.
