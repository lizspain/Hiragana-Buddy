// Builds public/icon.svg and the PNG app icons from the あ stroke data.
// Pure Node (zlib only), no image libraries: node scripts/make-icons.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const a = JSON.parse(readFileSync(new URL("data/kana-strokes.json", root), "utf8")).kana["あ"];

const BG = [255, 225, 196];
const INK = [74, 59, 53];
const DOT = [63, 174, 116];

// Glyph sits inside the maskable safe zone (centre 80%), scaled to 70%.
const G = 0.7;
const O = (1 - G) / 2;

function render(size) {
  const px = Buffer.alloc(size * size * 3);
  const lines = a.strokes.map((s) => s.points.map(([x, y]) => [(O + x * G) * size, (O + y * G) * size]));
  const w = size * 0.045;
  const dot = lines[0][0];
  const dotR = size * 0.05;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      let d = Infinity;
      for (const l of lines) for (let i = 1; i < l.length; i++) d = Math.min(d, segDist(cx, cy, l[i - 1], l[i]));
      const ink = clamp01(w - d + 0.5);
      const dd = clamp01(dotR - Math.hypot(cx - dot[0], cy - dot[1]) + 0.5);
      let c = mix(BG, INK, ink);
      c = mix(c, DOT, dd);
      px.set(c.map(Math.round), (y * size + x) * 3);
    }
  }
  return png(size, px);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-9));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function png(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(new URL(`public/${name}`, root), render(size));
  console.log("wrote", name);
}

const k = 109;
const paths = a.strokes.map((s) => `<path d="${s.d}"/>`).join("");
const [sx, sy] = a.strokes[0].points[0];
writeFileSync(
  new URL("public/icon.svg", root),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${k} ${k}"><rect width="${k}" height="${k}" rx="24" fill="#ffe1c4"/>` +
    `<g transform="translate(${O * k} ${O * k}) scale(${G})" fill="none" stroke="#4a3b35" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `<circle cx="${(O + sx * G) * k}" cy="${(O + sy * G) * k}" r="${0.05 * k}" fill="#3fae74"/></svg>\n`,
);
console.log("wrote icon.svg");
