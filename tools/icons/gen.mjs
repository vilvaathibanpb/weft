#!/usr/bin/env node
// Generate Weft icons (rounded accent square + white "weave" waves) as real PNGs — no deps.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ACCENT = [59, 110, 245]; // #3b6ef5

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(N) {
  const r = N * 0.22;            // corner radius
  const A = N * 0.085;           // wave amplitude
  const w = Math.max(1.4, N * 0.085); // stroke width
  const rows = [];
  const insideRR = (x, y) => {
    // rounded-rect signed check
    const dx = Math.max(r - x, x - (N - r), 0);
    const dy = Math.max(r - y, y - (N - r), 0);
    return Math.hypot(dx, dy) <= r + 0.5 || (x >= r && x <= N - r) || (y >= r && y <= N - r)
      ? insideCore(x, y) : false;
  };
  const insideCore = (x, y) => {
    if (x >= 0 && y >= r && x <= N && y <= N - r) return x >= 0 && x <= N;
    return true;
  };
  // Simpler robust rounded-rect test:
  const inRR = (x, y) => {
    const cx = Math.min(Math.max(x, r), N - r);
    const cy = Math.min(Math.max(y, r), N - r);
    return Math.hypot(x - cx, y - cy) <= r;
  };
  const waveY = (x, cy, phase) => cy + A * Math.sin((x / N) * Math.PI * 2 * 1.25 + phase);

  for (let y = 0; y < N; y++) {
    const row = Buffer.alloc(1 + N * 4); // filter byte + RGBA
    for (let x = 0; x < N; x++) {
      const o = 1 + x * 4;
      if (!inRR(x + 0.5, y + 0.5)) { row[o + 3] = 0; continue; }
      let [R, G, B] = ACCENT;
      const d1 = Math.abs((y + 0.5) - waveY(x + 0.5, N * 0.40, 0));
      const d2 = Math.abs((y + 0.5) - waveY(x + 0.5, N * 0.63, Math.PI));
      const d = Math.min(d1, d2);
      if (d <= w / 2) { R = G = B = 255; }
      else if (d <= w / 2 + 1) { const t = d - w / 2; R = R + (255 - R) * (1 - t); G = G + (255 - G) * (1 - t); B = B + (255 - B) * (1 - t); }
      row[o] = R; row[o + 1] = G; row[o + 2] = B; row[o + 3] = 255;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outExt = join(here, "../../extension/icons");
mkdirSync(outExt, { recursive: true });
for (const n of [16, 48, 128]) {
  writeFileSync(join(outExt, `icon${n}.png`), png(n));
  console.log(`wrote extension/icons/icon${n}.png`);
}

// 1024px source for `tauri icon` (generates the app's icns/ico/png set).
writeFileSync(join(here, "weft-source.png"), png(1024));
console.log("wrote tools/icons/weft-source.png");
