/**
 * Offline license verification (app side).
 *
 * A license is `base64url(payload).base64url(signature)`, signed with the vendor's Ed25519 key.
 * We verify it locally against the embedded PUBLIC key — no network, no account. Same format and
 * key as `crates/weft-core/src/license.rs` (authoritative in the real app) and `tools/license`.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

// noble-ed25519 v2 needs a sync sha512 for synchronous verify.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// Public key only — safe to ship. Private key lives in tools/license/keys (gitignored).
const PUBLIC_KEY_HEX = "6c3591bbfbb6543d9580f89781da4b8564d484ed920b705d16ab34e97090a020";
const APP_MAJOR = 1;

export interface License {
  name: string;
  edition: string; // "personal" | "team"
  major: number;
  issued: string;
  id: string;
}

export function verifyLicense(input: string): License | null {
  try {
    const raw = input.trim().replace(/^WEFT-/i, "");
    const [p, s] = raw.split(".");
    if (!p || !s) return null;
    const payload = b64uToBytes(p);
    const sig = b64uToBytes(s);
    if (!ed.verify(sig, payload, PUBLIC_KEY_HEX)) return null;

    const o = JSON.parse(new TextDecoder().decode(payload));
    const lic: License = { name: o.n, edition: o.e, major: o.m, issued: o.iss, id: o.id };
    if (lic.major !== APP_MAJOR) return null; // this key is for a different major version
    return lic;
  } catch {
    return null;
  }
}

function b64uToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
