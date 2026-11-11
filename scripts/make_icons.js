// Draws the app icons as PNG files (no extra packages needed).
//   node scripts/make_icons.js
// Output: public/icons/*.png — used for the Home Screen, splash and push notifications.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const BRAND = [43, 74, 203];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Distance from point to segment.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function inRoundRect(x, y, s, r) {
  if (r <= 0) return x >= 0 && y >= 0 && x <= s && y <= s;
  const cx = Math.max(r, Math.min(s - r, x));
  const cy = Math.max(r, Math.min(s - r, y));
  return Math.hypot(x - cx, y - cy) <= r;
}

// Icon on a 64-unit grid (same as icon.svg): blue rounded square with a white tick.
function draw(size, { radius = 16, bg = true, scale = 1, tickColor = [255, 255, 255] } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling
  const u = size / 64;
  const c = 32;
  const pts = [[19, 33.5], [28, 42.5], [45, 23.5]].map(([x, y]) => [c + (x - c) * scale, c + (y - c) * scale]);
  const half = 3 * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0, tickHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const gx = (x + (sx + 0.5) / SS) / u;
          const gy = (y + (sy + 0.5) / SS) / u;
          if (!bg || inRoundRect(gx, gy, 64, radius)) bgHits++;
          const d = Math.min(segDist(gx, gy, ...pts[0], ...pts[1]), segDist(gx, gy, ...pts[1], ...pts[2]));
          if (d <= half) tickHits++;
        }
      }
      const n = SS * SS;
      const a = bg ? bgHits / n : 0;
      const t = tickHits / n;
      const i = (y * size + x) * 4;
      if (bg) {
        const alpha = a;
        buf[i] = Math.round(BRAND[0] * (1 - t) + tickColor[0] * t);
        buf[i + 1] = Math.round(BRAND[1] * (1 - t) + tickColor[1] * t);
        buf[i + 2] = Math.round(BRAND[2] * (1 - t) + tickColor[2] * t);
        buf[i + 3] = Math.round(255 * alpha);
      } else {
        buf[i] = tickColor[0]; buf[i + 1] = tickColor[1]; buf[i + 2] = tickColor[2];
        buf[i + 3] = Math.round(255 * t);
      }
    }
  }
  return png(size, buf);
}

const files = {
  'icon-192.png': draw(192),
  'icon-512.png': draw(512),
  'icon-maskable-512.png': draw(512, { radius: 0, scale: 0.78 }),
  'apple-touch-icon.png': draw(180, { radius: 0 }),
  'badge-96.png': draw(96, { bg: false, scale: 1.25 })
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`  ${name}  ${data.length} bytes`);
}
