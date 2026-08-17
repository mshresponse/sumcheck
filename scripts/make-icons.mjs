#!/usr/bin/env node
/**
 * Verifies the Sumcheck icons, and rebuilds the magnified inspection strip.
 *
 *   node scripts/make-icons.mjs            verify + refresh docs/icon-inspection.png
 *   node scripts/make-icons.mjs --force    REDRAW the icons (disaster recovery)
 *
 * **The PNGs in `icons/` are committed assets, not build products.** They are
 * the approved renders of the mark; `npm run build` must never overwrite them.
 * An icon is a design decision that was reviewed by a human looking at it, and
 * a build step that silently redraws one can undo that review without anyone
 * noticing — which is exactly how this project shipped a malformed sigma once
 * already.
 *
 * So the default path only reads: it checks the files exist, decode, and carry
 * the dimensions and store-spec geometry they are supposed to, then rebuilds
 * `docs/icon-inspection.png` **from the committed PNGs** so the strip a reviewer
 * looks at is the thing that ships.
 *
 * The drawing code lives on behind `--force`, for the day the assets are lost.
 * It is not the source of truth and says so when it runs.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');
const STRIP = path.join(ROOT, 'docs', 'icon-inspection.png');
const PORT = 9421;

/**
 * What each icon must be.
 *
 * `badge` records which sizes carry the green check — 32 and 16 drop it because
 * at those sizes it reads as dirt rather than a badge.
 *
 * `tile` is the store requirement, and only the 128 has one: the Chrome Web
 * Store listing icon is 96x96 of artwork inside 16px of transparent padding.
 * It is measured against the accent square rather than the ink bounding box,
 * because the badge deliberately overhangs the square by a few pixels — the ink
 * box is 109x109, the artwork is 96x96, and only the second is what the spec is
 * talking about.
 */
const EXPECTED = [
  { size: 128, badge: true, tile: { side: 96, at: 16 } },
  { size: 48, badge: true },
  { size: 32, badge: true },
  // Only 16 drops the badge: below about 20px the green disc and its tick
  // collapse into a smudge that reads as dirt rather than as a mark.
  { size: 16, badge: false },
];

const MAGNIFY = { 16: 12, 32: 6, 48: 4, 128: 1.5 };

/* ------------------------------------------------------------------- PNG */

/** Decode an 8-bit RGBA PNG, undoing the per-scanline filters. */
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  if (depth !== 8 || colorType !== 6) {
    throw new Error(`expected 8-bit RGBA, got depth ${depth} colour type ${colorType}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, px };
}

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/* ---------------------------------------------------------------- verify */

/** Bounding box of pixels matching `pred`, ignoring near-transparent ones. */
function boundsOf({ width, height, px }, pred) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (px[i + 3] <= 40) continue;
      if (!pred(px[i], px[i + 1], px[i + 2])) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, count, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const isAccent = (r, g, b) => b > 110 && b > g + 40 && r < 160;
const isBadge = (r, g, b) => g > 120 && g > r + 40 && g > b + 20;

function verify() {
  const problems = [];
  const notes = [];
  const decoded = new Map();

  for (const { size, badge, tile } of EXPECTED) {
    const file = path.join(OUT, `icon-${size}.png`);
    if (!fs.existsSync(file)) {
      problems.push(`icons/icon-${size}.png is missing — it is a committed asset, restore it from git`);
      continue;
    }
    let image;
    try {
      image = decodePng(fs.readFileSync(file));
    } catch (err) {
      problems.push(`icons/icon-${size}.png does not decode: ${err.message}`);
      continue;
    }
    decoded.set(size, image);

    if (image.width !== size || image.height !== size) {
      problems.push(`icons/icon-${size}.png is ${image.width}x${image.height}, expected ${size}x${size}`);
    }

    const ink = boundsOf(image, () => true);
    if (ink.count === 0) {
      problems.push(`icons/icon-${size}.png is entirely transparent`);
      continue;
    }
    if (ink.minX < 0 || ink.minY < 0 || ink.maxX > image.width - 1 || ink.maxY > image.height - 1) {
      problems.push(`icons/icon-${size}.png has artwork clipped at the canvas edge`);
    }

    const green = boundsOf(image, isBadge);
    const hasBadge = green.count > (size * size) / 400;
    if (badge && !hasBadge) problems.push(`icons/icon-${size}.png should carry the check badge and does not`);
    if (!badge && hasBadge) {
      problems.push(`icons/icon-${size}.png should not carry the badge at this size — it reads as dirt`);
    }

    if (tile) {
      // The store spec, measured on the accent square. The badge overhangs it
      // deliberately, so the ink box is larger and is not what is being checked.
      const accent = boundsOf(image, isAccent);
      const ok =
        accent.width === tile.side &&
        accent.height === tile.side &&
        accent.minX === tile.at &&
        accent.minY === tile.at;
      if (!ok) {
        problems.push(
          `icons/icon-${size}.png breaks the store spec: the accent tile is ` +
            `${accent.width}x${accent.height} at (${accent.minX},${accent.minY}), ` +
            `expected ${tile.side}x${tile.side} at (${tile.at},${tile.at})`
        );
      } else {
        const overhang = ink.maxX - (accent.maxX);
        notes.push(
          `icon-${size}: tile ${accent.width}x${accent.height} at (${accent.minX},${accent.minY}) ` +
            `— store spec OK; badge overhangs ${overhang}px into the padding`
        );
      }
    } else {
      notes.push(`icon-${size}: ${image.width}x${image.height}, artwork ${ink.width}x${ink.height}${badge ? ', badge present' : ''}`);
    }
  }
  return { problems, notes, decoded };
}

/**
 * A 3x5 bitmap for each digit, so the strip can label its columns. Drawing
 * text is the only thing the pure-Node path cannot do for free, and an
 * unlabelled inspection strip makes the reviewer count pixels to work out
 * which icon they are looking at.
 */
const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

/** Draw `text` (digits only) at 2x scale into an RGBA buffer. */
function drawLabel(canvas, width, text, x0, y0, scale = 2) {
  let cursor = x0;
  for (const ch of text) {
    const glyph = DIGITS[ch];
    if (!glyph) { cursor += 2 * scale; continue; }
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cursor + gx * scale + sx;
            const py = y0 + gy * scale + sy;
            const i = (py * width + px) * 4;
            canvas[i] = 68;
            canvas[i + 1] = 68;
            canvas[i + 2] = 76;
          }
        }
      }
    }
    cursor += 4 * scale;
  }
  return cursor - x0 - scale;
}

/* ----------------------------------------------------------------- strip */

/**
 * The magnified strip, built from the committed PNGs with nearest-neighbour
 * scaling so a reviewer sees the actual pixels rather than a re-render.
 */
function buildStrip(decoded) {
  const entries = EXPECTED.map(({ size }) => ({ size, image: decoded.get(size) })).filter((e) => e.image);
  if (!entries.length) return false;

  const gap = 18;
  const labelBand = 22;
  const heights = entries.map((e) => Math.round(e.size * MAGNIFY[e.size]));
  const width = entries.reduce((a, e) => a + Math.round(e.size * MAGNIFY[e.size]) + gap, gap);
  const height = Math.max(...heights) + gap * 2 + labelBand;
  const canvas = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    canvas[i * 4] = 245;
    canvas[i * 4 + 1] = 245;
    canvas[i * 4 + 2] = 248;
    canvas[i * 4 + 3] = 255;
  }

  let x0 = gap;
  for (const { size, image } of entries) {
    const k = MAGNIFY[size];
    const dim = Math.round(size * k);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const sx = Math.min(image.width - 1, Math.floor(x / k));
        const sy = Math.min(image.height - 1, Math.floor(y / k));
        const si = (sy * image.width + sx) * 4;
        const di = ((y + gap) * width + (x + x0)) * 4;
        const alpha = image.px[si + 3] / 255;
        for (let c = 0; c < 3; c++) {
          canvas[di + c] = Math.round(canvas[di + c] * (1 - alpha) + image.px[si + c] * alpha);
        }
      }
    }
    const label = String(size);
    const labelWidth = label.length * 8 - 2;
    drawLabel(canvas, width, label, Math.round(x0 + dim / 2 - labelWidth / 2), gap + Math.max(...heights) + 8);
    x0 += dim + gap;
  }

  fs.mkdirSync(path.dirname(STRIP), { recursive: true });
  fs.writeFileSync(STRIP, encodePng(canvas, width, height));
  return true;
}

/* ------------------------------------------------------------------ main */

async function main() {
  const force = process.argv.includes('--force');
  const { problems, notes, decoded } = verify();

  if (force) {
    console.warn('');
    console.warn('  ⚠  --force: REDRAWING icons/icon-*.png');
    console.warn('     These are committed, human-approved assets. The drawing code is');
    console.warn('     disaster recovery, not the source of truth: it will not reproduce');
    console.warn('     the approved renders byte for byte, and the result needs a human');
    console.warn('     to look at docs/icon-inspection.png before it is committed.');
    console.warn('');
    await regenerate();
    const after = verify();
    for (const note of after.notes) console.log(`  ${note}`);
    buildStrip(after.decoded);
    console.log(`  docs/icon-inspection.png  rebuilt`);
    if (after.problems.length) {
      console.error(`\n✗ the redrawn icons do not meet spec:`);
      for (const p of after.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log('\n✓ icons redrawn — now look at docs/icon-inspection.png before committing');
    return;
  }

  for (const note of notes) console.log(`  ${note}`);
  if (problems.length) {
    console.error(`\n✗ ${problems.length} icon problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  icons/ holds committed assets. Restore them from git rather than`);
    console.error(`  redrawing; "--force" exists only if they are genuinely lost.`);
    process.exit(1);
  }
  if (buildStrip(decoded)) console.log(`  docs/icon-inspection.png  rebuilt from the committed icons`);
  console.log(`✓ ${EXPECTED.length} icons verified (not rewritten)`);
}

/* ------------------------------------------------- disaster recovery only */

/**
 * Redraw the mark from scratch. Only reachable via `--force`.
 *
 * Renders each variant once at 1024px and downscales by repeated halving —
 * drawing straight to 16px puts every edge on a half-pixel — and takes the
 * sigma from `fillText`, because hand-authored glyph geometry is what produced
 * uneven bars and a stair-stepped diagonal the first time.
 */
async function regenerate() {
  const chromePath = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean).find((p) => fs.existsSync(p));
  if (!chromePath) throw new Error('no Chrome/Chromium found; set CHROME_PATH');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sumcheck-icons-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => {
    try { chrome.kill('SIGKILL'); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  try {
    let target;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!target) throw new Error('headless Chrome did not start');

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => socket.addEventListener('open', r));
    const value = await new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        socket.removeEventListener('message', onMessage);
        const details = message.result?.exceptionDetails;
        if (details) reject(new Error(details.exception?.description || 'page threw'));
        else resolve(message.result?.result?.value);
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(${drawInPage.toString()})(${JSON.stringify(EXPECTED)})`,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    });
    if (value.error) throw new Error(value.error);
    for (const { size, dataUrl } of value.icons) {
      fs.writeFileSync(path.join(OUT, `icon-${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`  icons/icon-${size}.png  redrawn`);
    }
    socket.close();
  } finally {
    cleanup();
  }
}

/** Runs inside the browser; serialized across the DevTools protocol. */
function drawInPage(expected) {
  const MASTER = 1024;
  const FACE = `"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif`;
  const canvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  function roundedRect(ctx, x, y, size, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + size, y, x + size, y + size, radius);
    ctx.arcTo(x + size, y + size, x, y + size, radius);
    ctx.arcTo(x, y + size, x, y, radius);
    ctx.arcTo(x, y, x + size, y, radius);
    ctx.closePath();
  }

  function drawMaster(withBadge, micro) {
    const c = canvas(MASTER);
    const ctx = c.getContext('2d');
    const inset = micro ? 0 : MASTER * 0.03;
    const square = MASTER * (withBadge ? 0.9 : micro ? 1 : 0.94);
    const radius = square * (micro ? 0.2 : 0.22);
    const gradient = ctx.createLinearGradient(0, inset, 0, inset + square);
    gradient.addColorStop(0, '#5f55f0');
    gradient.addColorStop(1, '#3930be');
    ctx.fillStyle = gradient;
    roundedRect(ctx, inset, inset, square, radius);
    ctx.fill();

    ctx.font = `${micro ? 900 : 800} ${square * (micro ? 0.74 : 0.62)}px ${FACE}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText('Σ');
    const inkW = m.actualBoundingBoxRight + m.actualBoundingBoxLeft;
    const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const shift = withBadge ? square * 0.045 : 0;
    const cx = inset + square / 2 - shift;
    const cy = inset + square / 2 - shift * 0.6;
    ctx.fillText('Σ', cx - inkW / 2 + m.actualBoundingBoxLeft, cy + inkH / 2 - m.actualBoundingBoxDescent);

    if (withBadge) {
      const bx = inset + square * 0.87;
      const by = inset + square * 0.87;
      const br = square * 0.2;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(bx, by, br * 1.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#4ec98a';
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0e2a1c';
      ctx.lineWidth = br * 0.28;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx - br * 0.42, by + br * 0.04);
      ctx.lineTo(bx - br * 0.09, by + br * 0.38);
      ctx.lineTo(bx + br * 0.45, by - br * 0.34);
      ctx.stroke();
    }
    return c;
  }

  function cropToInk(source) {
    const ctx = source.getContext('2d');
    const { data } = ctx.getImageData(0, 0, source.width, source.height);
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        if (data[(y * source.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return source;
    const side = Math.max(maxX - minX + 1, maxY - minY + 1);
    const out = canvas(Math.ceil(side));
    const cx = (minX + maxX + 1) / 2;
    const cy = (minY + maxY + 1) / 2;
    out.getContext('2d').drawImage(source, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side, 0, 0, side, side);
    return out;
  }

  function downscale(source, width) {
    let current = source;
    while (current.width / 2 >= width) {
      const next = canvas(current.width / 2);
      const ctx = next.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(current, 0, 0, next.width, next.height);
      current = next;
    }
    if (current.width !== width) {
      const out = canvas(width);
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(current, 0, 0, width, width);
      current = out;
    }
    return current;
  }

  try {
    const probe = canvas(8).getContext('2d');
    probe.font = `800 100px ${FACE}`;
    if (probe.measureText('Σ').width < 20) return { error: 'the system font produced no sigma glyph' };

    const masters = {
      full: cropToInk(drawMaster(true, false)),
      plain: cropToInk(drawMaster(false, false)),
      micro: cropToInk(drawMaster(false, true)),
    };
    const icons = [];
    for (const { size, badge, tile } of expected) {
      const variant = badge ? 'full' : size <= 16 ? 'micro' : 'plain';
      const pad = tile ? tile.at / size : size <= 16 ? 0 : 0.03;
      const artwork = Math.round(size * (1 - pad * 2));
      const reduced = downscale(masters[variant], artwork);
      const out = canvas(size);
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const offset = Math.round((size - artwork) / 2);
      ctx.drawImage(reduced, offset, offset);
      icons.push({ size, dataUrl: out.toDataURL('image/png') });
    }
    return { icons };
  } catch (err) {
    return { error: err.message };
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
