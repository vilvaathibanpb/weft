# Weft — Monetization

**One-time purchase. Own it forever. No subscription, no account, no cloud.**

This fits the product's whole premise: Weft is local-first and never phones home. The license is
offline too, so there is *no server anywhere* — not for data, not for sync, not for licensing.

---

## 1. The model

### Free trial
- **14 days, fully featured.** No account, no card. First-run timestamp stored locally.
- At expiry the app keeps your converted MCPs readable but pauses serving until licensed (never
  deletes anything).

### Buy once
- **Personal — one-time ~$39.** Every feature. Perpetual license for the current major version,
  **including all `1.x` updates**.
- **Team — one-time ~$29/seat** (volume), same license, for commercial/multi-seat use.

### Paid major upgrades (the sustainability lever)
- `2.0` is an optional, **discounted** paid upgrade for existing owners (e.g. ~50% off).
- This is the standard indie pattern (Sublime Text, older Things, many Mac utilities): one-time
  pricing stays honest while major releases fund ongoing work. The alternative — "lifetime
  updates forever" — is simpler but eventually starves development; recommend paid majors.

Everything that used to be "Pro" (auto health-monitoring, scheduled re-capture, OpenAPI/Postman
export, extension-free agent capture) is **just included**. No tiers inside the app.

---

## 2. Licensing mechanics (offline, no server)
- License key is an **Ed25519-signed token** containing name + edition + major version.
- The app verifies the signature **locally** with a bundled public key. No activation call, no
  phone-home — consistent with "nothing leaves your machine."
- Trade-off: offline keys can be shared/cracked. Accept it (indie-standard). Keep the honest
  path easy and cheap; don't punish real users with DRM. If piracy ever matters, add an
  *optional* one-time online activation with a revocation list — but it's not needed to ship.

---

## 3. Distribution & payments
- **Direct download**, sold through a **merchant-of-record** (Paddle / Lemon Squeezy / Polar) so
  they handle global VAT/sales tax and issue the license key on purchase. Best margin,
  cross-platform (one license works on macOS, Windows, Linux).
- **App stores later, for discovery** (Mac App Store / Microsoft Store): note the 15–30% cut and
  macOS sandbox constraints (child-process spawning + some entitlements) that the direct build
  avoids. Treat stores as a marketing channel, not the primary one.

---

## 4. Not revenue lines (kept free)
- **Discover recipes** — community endpoint maps (maps only, never credentials). A free feature
  that drives adoption, not a paywall.

---

## 5. Rough math (illustrative)
- One dev tool sale ≈ $39 gross, ~$30 net after MoR fees/tax handling.
- No per-user infra cost (local-first, offline license) → essentially all net is margin.
- Revenue = new buyers + periodic paid major upgrades. Model a baseline on steady-state
  downloads × trial→buy conversion (indie dev tools often ~3–8% of active trials).

---

## 6. Risks
- **Sustainability without recurring revenue** — covered by paid major upgrades; keep a visible
  roadmap so upgrades feel earned.
- **Site ToS / anti-automation** — unchanged from `PLAN.md §8`: sell *a local tool pointed at the
  user's own sessions*, ship maps-not-credentials, let signed-request sites land in "Not possible".
- **Trust is the product** — credentials never leave the device; now neither does anything else,
  including the license check. Say it loudly; it's a real differentiator.
