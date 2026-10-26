'use strict';

// Draws the app and tray icons without any image dependencies:
// a purple squircle with the black island pill near the top.
// Usage: npm run icon

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SAMPLES = 4;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function roundedRect(px, py, x, y, w, h, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function draw(size, { drawer }) {
  const top = hex('#D49BFF');
  const bottom = hex('#8A35EE');
  const ink = [0, 0, 0];
  const pixels = Buffer.alloc(size * size * 4);

  const pad = size * 0.06;
  const body = { x: pad, y: pad, w: size - pad * 2, h: size - pad * 2, r: size * 0.23 };
  const pill = { w: size * 0.5, h: size * 0.16 };
  pill.x = (size - pill.w) / 2;
  pill.y = size * (drawer ? 0.2 : 0.3);
  const sheet = { x: size * 0.2, y: size * 0.44, w: size * 0.6, h: size * 0.34, r: size * 0.09 };
  const dot = { x: pill.x + pill.w - pill.h / 2, y: pill.y + pill.h / 2, r: pill.h * 0.2 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = [0, 0, 0];
      let alpha = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          if (!roundedRect(px, py, body.x, body.y, body.w, body.h, body.r)) continue;
          let c = mix(top, bottom, (py - body.y) / body.h);
          if (drawer && roundedRect(px, py, sheet.x, sheet.y, sheet.w, sheet.h, sheet.r)) c = mix(c, ink, 0.28);
          if (roundedRect(px, py, pill.x, pill.y, pill.w, pill.h, pill.h / 2)) {
            c = (px - dot.x) ** 2 + (py - dot.y) ** 2 <= dot.r ** 2 ? hex('#3A2A4A') : ink;
          }
          color = color.map((v, i) => v + c[i]);
          alpha += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (alpha) color.forEach((v, k) => (pixels[i + k] = Math.round(v / alpha)));
      pixels[i + 3] = Math.round((alpha / SAMPLES ** 2) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0]), rgba.subarray(y * size * 4, (y + 1) * size * 4));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, size, options] of [
  ['icon.png', 512, { drawer: true }],
  ['tray.png', 32, { drawer: false }],
]) {
  fs.writeFileSync(path.join(outDir, name), encodePng(size, draw(size, options)));
  console.log('wrote', path.join('assets', name));
}
