// Shared license format. A license is:  base64url(payload) + "." + base64url(signature)
// payload = compact JSON, signed with the vendor's Ed25519 private key.
import { sign as edSign, verify as edVerify } from "node:crypto";

export const b64u = {
  enc: (buf) => Buffer.from(buf).toString("base64url"),
  dec: (s) => Buffer.from(s, "base64url"),
};

/** Build the canonical payload bytes. Field order is fixed so signatures are stable. */
export function payloadBytes({ name, edition, major, issued, id }) {
  const json = JSON.stringify({ n: name, e: edition, m: major, iss: issued, id });
  return Buffer.from(json, "utf8");
}

export function makeLicense(fields, privateKey) {
  const payload = payloadBytes(fields);
  const sig = edSign(null, payload, privateKey); // Ed25519 → 64 bytes
  return `${b64u.enc(payload)}.${b64u.enc(sig)}`;
}

/** Verify with a raw 32-byte public key (hex). Returns the parsed license or null. */
export function verifyLicense(license, publicKeyDerOrKeyObject) {
  try {
    const [p, s] = String(license).trim().replace(/^WEFT-/, "").split(".");
    if (!p || !s) return null;
    const payload = b64u.dec(p);
    const sig = b64u.dec(s);
    const ok = edVerify(null, payload, publicKeyDerOrKeyObject, sig);
    if (!ok) return null;
    const obj = JSON.parse(payload.toString("utf8"));
    return { name: obj.n, edition: obj.e, major: obj.m, issued: obj.iss, id: obj.id };
  } catch {
    return null;
  }
}
