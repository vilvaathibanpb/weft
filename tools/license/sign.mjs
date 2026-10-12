#!/usr/bin/env node
// Sign a perpetual license.  Usage:
//   node sign.mjs --name "Ada Lovelace" --edition personal [--major 1] [--id order_123]
// Run this from the merchant-of-record purchase webhook, or by hand for a key.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeLicense } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}

const name = arg("--name");
const edition = arg("--edition", "personal");
const major = Number(arg("--major", "1"));
const id = arg("--id", "manual-" + Date.now());
if (!name) { console.error('Missing --name. Example: --name "Ada Lovelace" --edition personal'); process.exit(1); }

const privateKey = createPrivateKey(readFileSync(join(here, "keys", "private.pem")));
const issued = new Date().toISOString().slice(0, 10);
const license = makeLicense({ name, edition, major, issued, id }, privateKey);

console.log(license);
