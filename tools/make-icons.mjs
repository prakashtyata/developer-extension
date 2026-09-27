/**
 * Generates icons/icon{16,48,128}.png so the repo stays dependency free.
 * Run: node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels, opaque) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  // Colour type 2 is truecolour with no alpha channel. The Chrome Web Store
  // listing icon is safest without one, so icon128 is written opaque.
  ihdr[9] = opaque ? 2 : 6;
  const bpp = opaque ? 3 : 4;
  const raw = Buffer.alloc(size * (size * bpp + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      raw[o++] = p[0];
      raw[o++] = p[1];
      raw[o++] = p[2];
      if (!opaque) raw[o++] = p[3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const BG = [47, 111, 208];
const FG = [255, 255, 255];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function draw(size, opaque) {
  const s = size;
  const pad = s * 0.16;
  const radius = s * 0.22;
  const stroke = Math.max(1.2, s * 0.075);
  const top = pad + s * 0.1;
  const bottom = s - pad - s * 0.1;
  const left = pad;
  const right = s - pad;

  const pts = [
    [left, top],
    [left + (right - left) * 0.25, bottom],
    [(left + right) / 2, top + (bottom - top) * 0.42],
    [left + (right - left) * 0.75, bottom],
    [right, top]
  ];

  const pixels = new Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let alpha = opaque ? 255 : 0;
      const cx = Math.min(Math.max(px, radius), s - radius);
      const cy = Math.min(Math.max(py, radius), s - radius);
      if (opaque || Math.hypot(px - cx, py - cy) <= radius) alpha = 255;

      let ink = false;
      if (alpha) {
        for (let i = 0; i < pts.length - 1 && !ink; i++) {
          if (distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= stroke) ink = true;
        }
      }
      const c = ink ? FG : BG;
      pixels[y * s + x] = [c[0], c[1], c[2], alpha];
    }
  }
  return encodePng(s, pixels, opaque);
}

await mkdir(resolve(root, 'icons'), { recursive: true });
// icon128 is the store listing icon and is written opaque. The 16 and 48 px
// icons only appear inside the browser UI, where transparency is expected.
for (const size of [16, 48, 128]) {
  await writeFile(resolve(root, `icons/icon${size}.png`), draw(size, size === 128));
  console.log(`icons/icon${size}.png`);
}
