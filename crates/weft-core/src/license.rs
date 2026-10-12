//! Offline license verification (authoritative, app side).
//!
//! Format: `base64url(payload).base64url(signature)`, Ed25519-signed by the vendor key.
//! Same format + public key as `apps/desktop/src/lib/license.ts` and `tools/license`.
//! No network, no account — the public key is compiled in.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Serialize;

/// Public key only (hex). The private key lives in tools/license/keys and never ships.
const PUBLIC_KEY_HEX: &str = "6c3591bbfbb6543d9580f89781da4b8564d484ed920b705d16ab34e97090a020";
const APP_MAJOR: u32 = 1;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct License {
    pub name: String,
    pub edition: String,
    pub major: u32,
    pub issued: String,
    pub id: String,
}

/// Verify a license string. Returns the parsed license iff the signature is valid and the key is
/// for this major version.
pub fn verify(input: &str) -> Option<License> {
    let raw = input.trim().strip_prefix("WEFT-").unwrap_or(input.trim());
    let (p, s) = raw.split_once('.')?;
    let payload = URL_SAFE_NO_PAD.decode(p).ok()?;
    let sig_bytes = URL_SAFE_NO_PAD.decode(s).ok()?;

    let key_bytes: [u8; 32] = hex::decode(PUBLIC_KEY_HEX).ok()?.try_into().ok()?;
    let vk = VerifyingKey::from_bytes(&key_bytes).ok()?;
    let sig = Signature::from_slice(&sig_bytes).ok()?;
    vk.verify(&payload, &sig).ok()?;

    let v: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    let lic = License {
        name: v.get("n")?.as_str()?.to_string(),
        edition: v.get("e")?.as_str()?.to_string(),
        major: v.get("m")?.as_u64()? as u32,
        issued: v.get("iss")?.as_str()?.to_string(),
        id: v.get("id")?.as_str()?.to_string(),
    };
    (lic.major == APP_MAJOR).then_some(lic)
}

#[cfg(test)]
mod tests {
    use super::*;
    // A real license signed by tools/license (Ada Lovelace, personal, major 1).
    const SAMPLE: &str = "eyJuIjoiQWRhIExvdmVsYWNlIiwiZSI6InBlcnNvbmFsIiwibSI6MSwiaXNzIjoiMjAyNi0xMC0wMSIsImlkIjoiZGVtby0wMDAxIn0.fqcsCrNHQqWO5m3w0GDa5FeUy721yLkTUj_iXUJU7p_T6zbunNGFqSPxK_jehwBOZxZLbEVNrsn2YixLLz0qCg";

    #[test]
    fn valid_license_verifies() {
        let lic = verify(SAMPLE).expect("should verify");
        assert_eq!(lic.name, "Ada Lovelace");
        assert_eq!(lic.edition, "personal");
    }

    #[test]
    fn tampered_license_rejected() {
        let bad = format!("{}ZZZ", &SAMPLE[..SAMPLE.len() - 3]);
        assert!(verify(&bad).is_none());
    }
}
