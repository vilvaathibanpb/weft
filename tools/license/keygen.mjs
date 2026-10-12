#!/usr/bin/env node
// Generate the vendor's Ed25519 signing keypair.
//   - private key → tools/license/keys/private.pem   (SECRET — gitignored, never ships)
//   - public key  → tools/license/keys/public.hex    (embed this in the app)
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const keysDir = join(here, "keys");
mkdirSync(keysDir, { recursive: true });

if (existsSync(join(keysDir, "private.pem")) && !process.argv.includes("--force")) {
  console.error("Refusing to overwrite existing keys. Pass --force to regenerate (invalidates all issued licenses).");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
const jwk = publicKey.export({ format: "jwk" });
const rawPub = Buffer.from(jwk.x, "base64url"); // 32 bytes
const pubHex = rawPub.toString("hex");

writeFileSync(join(keysDir, "private.pem"), privPem, { mode: 0o600 });
writeFileSync(join(keysDir, "public.hex"), pubHex + "\n");

console.log("Keypair written to tools/license/keys/");
console.log("PUBLIC KEY (embed in app, hex):");
console.log(pubHex);
console.log("\nKeep private.pem secret. It never ships and signs every license.");
