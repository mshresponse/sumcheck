#!/usr/bin/env node
/**
 * fetch-vendor.mjs — download and stage every third-party runtime dependency
 * into ./vendor/ so the extension ships 100% self-contained.
 *
 * Chrome MV3 forbids remote code, so nothing may be pulled from a CDN at
 * runtime. This script is the only thing that touches the network, and it runs
 * at build time.
 *
 * Usage:
 *   node scripts/fetch-vendor.mjs                 # english OCR only
 *   node scripts/fetch-vendor.mjs --langs eng,deu,fra,spa
 *   node scripts/fetch-vendor.mjs --no-cmaps      # skip CJK cmaps (~1.5 MB)
 *
 * Every package below is MIT / Apache-2.0 / BSD-2 / MPL-2.0-or-Apache-2.0.
 * See docs/LICENSING.md for the compliance checklist.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const TMP = path.join(ROOT, '.vendor-tmp');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i === -1 ? dflt : argv[i + 1];
};
const LANGS = argVal('--langs', 'eng')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const WITH_CMAPS = !argv.includes('--no-cmaps');
// osd.traineddata costs ~4.3 MB and is only consulted by the OSD page-seg
// modes. Opt in with --osd if you enable auto-rotation for skewed scans.
const WITH_OSD = argv.includes('--osd');

/** dir/file copy list is relative to the extracted `package/` root. */
const PACKAGES = [
  {
    name: 'pdfjs-dist',
    version: '6.2.108',
    license: 'Apache-2.0',
    out: 'pdfjs',
    copy: [
      ['build/pdf.min.mjs', 'pdf.min.mjs'],
      ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
      ['wasm', 'wasm'],
      ['standard_fonts', 'standard_fonts'],
      ['LICENSE', 'LICENSE'],
      ...(WITH_CMAPS ? [['cmaps', 'cmaps']] : []),
    ],
  },
  {
    name: 'wordlist-english',
    version: '1.2.1',
    license: 'MIT (word lists: SCOWL, Copyright 2000-2016 Kevin Atkinson)',
    out: 'wordlist',
    // The tier files are the raw material; buildWordlists() below turns them
    // into the two flat files the validator actually loads.
    copy: [
      ...[10, 20, 35, 40, 50, 55, 60, 70].flatMap((t) => [
        [`english-words-${t}.json`, `src/english-words-${t}.json`],
        [`american-words-${t}.json`, `src/american-words-${t}.json`],
      ]),
      ['Copyright', 'LICENSE-scowl'],
    ],
  },
  {
    name: 'most-common-words-by-language',
    version: '3.0.14',
    // The package declares MIT in package.json and ships no LICENSE file, so
    // there is no license text to vendor. Recorded here so the notices are
    // accurate about which of the two it is.
    license: 'MIT (declared in package.json; package ships no LICENSE file)',
    out: 'wordlist',
    copy: [['build/resources/english.txt', 'src/frequency-english.txt']],
  },
  {
    name: 'tesseract.js',
    version: '6.0.1',
    license: 'Apache-2.0',
    out: 'tesseract',
    copy: [
      ['dist/tesseract.min.js', 'tesseract.min.js'],
      ['dist/worker.min.js', 'worker.min.js'],
      ['LICENSE.md', 'LICENSE.md'],
    ],
  },
  {
    name: 'tesseract.js-core',
    version: '6.1.2',
    license: 'Apache-2.0',
    // Must sit next to worker.min.js: the Emscripten glue resolves its .wasm
    // against the *worker's* own URL, not against corePath.
    out: 'tesseract',
    // Chrome >= 116 (our floor) always has WASM SIMD, and we only ever use the
    // LSTM engine, so the SIMD+LSTM core is the only variant worth shipping.
    // The other three cost ~12 MB of package size for zero benefit.
    copy: [
      ['tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.js'],
      ['tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
      ['LICENSE', 'LICENSE-core'],
    ],
  },
  {
    name: 'turndown',
    version: '7.2.4',
    license: 'MIT',
    out: 'turndown',
    copy: [
      ['dist/turndown.js', 'turndown.js'],
      ['LICENSE', 'LICENSE'],
    ],
  },
  {
    name: 'turndown-plugin-gfm',
    version: '1.0.2',
    license: 'MIT',
    out: 'turndown',
    copy: [
      ['dist/turndown-plugin-gfm.js', 'turndown-plugin-gfm.js'],
      ['LICENSE', 'LICENSE-gfm'],
    ],
  },
  {
    name: 'marked',
    version: '18.0.9',
    license: 'MIT',
    out: 'marked',
    copy: [
      ['lib/marked.umd.js', 'marked.umd.js'],
      ['LICENSE', 'LICENSE'],
    ],
  },
  {
    name: 'mammoth',
    version: '1.12.1',
    license: 'BSD-2-Clause',
    out: 'mammoth',
    copy: [
      ['mammoth.browser.min.js', 'mammoth.browser.min.js'],
      ['LICENSE', 'LICENSE'],
    ],
  },
  {
    name: 'jszip',
    version: '3.10.1',
    license: 'MIT (dual MIT OR GPL-3.0 — we elect MIT)',
    out: 'jszip',
    copy: [
      ['dist/jszip.min.js', 'jszip.min.js'],
      ['LICENSE.markdown', 'LICENSE.markdown'],
    ],
  },
  {
    name: 'papaparse',
    version: '5.6.0',
    license: 'MIT',
    out: 'papaparse',
    copy: [
      ['papaparse.min.js', 'papaparse.min.js'],
      ['LICENSE', 'LICENSE'],
    ],
  },
  {
    name: 'js-yaml',
    version: '5.3.0',
    license: 'MIT',
    out: 'js-yaml',
    copy: [
      ['dist/browser/js-yaml.umd.min.js', 'js-yaml.umd.min.js'],
      ['LICENSE', 'LICENSE'],
    ],
  },
  {
    name: 'dompurify',
    version: '3.4.13',
    license: 'Apache-2.0 (dual MPL-2.0 OR Apache-2.0 — we elect Apache-2.0)',
    out: 'dompurify',
    copy: [
      ['dist/purify.min.js', 'purify.min.js'],
      ['LICENSE', 'LICENSE'],
    ],
  },
  {
    name: '@mozilla/readability',
    version: '0.6.0',
    license: 'Apache-2.0',
    out: 'readability',
    copy: [
      ['Readability.js', 'Readability.js'],
      ['LICENSE.md', 'LICENSE.md'],
    ],
  },
];

/**
 * Which trained models to ship.
 *
 * `fast` is the tempting default and the wrong one for documents: it is a
 * heavily quantized model that loses accuracy on small type, which is exactly
 * where a scanned invoice lives. `best` is LSTM-only float weights — slower and
 * larger, but it is the difference between reading a price correctly and not.
 */
const TESSDATA_REPOS = {
  fast: 'tessdata_fast',
  standard: 'tessdata',
  best: 'tessdata_best',
};
const QUALITY = argVal('--quality', 'best');
const TESSDATA_BASE = `https://raw.githubusercontent.com/tesseract-ocr/${
  TESSDATA_REPOS[QUALITY] || TESSDATA_REPOS.best
}/4.1.0`;

function log(...a) {
  console.log('  ', ...a);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyPath(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function pack(name, version) {
  const spec = `${name}@${version}`;
  const out = execFileSync(
    'npm',
    ['pack', spec, '--pack-destination', TMP, '--silent'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const tgz = out.trim().split('\n').filter(Boolean).pop();
  return path.join(TMP, tgz);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/**
 * Turn the two vendored word sources into the two flat files the prose lexicon
 * validator loads at runtime.
 *
 *   english.txt  every known word, one per line, sorted   — "is this a word?"
 *   common.txt   the ~9k most frequent, in frequency order — "what did they mean?"
 *
 * They answer different questions and both are needed. A dictionary alone
 * cannot rank suggestions: "inchided" is two edits from both "included" and
 * "inclined", and only frequency separates them. Frequency alone cannot judge
 * membership: it has never heard of "appendicular", which is a perfectly good
 * word sitting in this corpus.
 *
 * Only words of four characters or more are kept, because that is the shortest
 * token the validator will look at, and dropping the rest is ~40% of the bytes.
 */
function buildWordlists() {
  const dir = path.join(VENDOR, 'wordlist');
  const srcDir = path.join(dir, 'src');
  if (!fs.existsSync(srcDir)) {
    console.warn('   ! wordlist sources missing — prose lexicon not built');
    return;
  }
  console.log('\n▸ wordlist  (building)');

  const known = new Set();
  for (const file of fs.readdirSync(srcDir)) {
    if (!/-words-\d+\.json$/.test(file)) continue;
    for (const word of JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8'))) {
      const w = String(word).toLowerCase();
      if (/^[a-z]{4,}$/.test(w)) known.add(w);
    }
  }
  const englishPath = path.join(dir, 'english.txt');
  fs.writeFileSync(englishPath, [...known].sort().join('\n') + '\n');
  log(`wordlist/english.txt  ${known.size} words  ${(fs.statSync(englishPath).size / 1e6).toFixed(2)} MB`);

  const freqRaw = fs.readFileSync(path.join(srcDir, 'frequency-english.txt'), 'utf8');
  const common = [];
  const seen = new Set();
  for (const line of freqRaw.split(/[\n,"\[\]]+/)) {
    const w = line.trim().toLowerCase();
    if (!/^[a-z]{4,}$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    common.push(w); // order is frequency order, and it is load-bearing
  }
  const commonPath = path.join(dir, 'common.txt');
  fs.writeFileSync(commonPath, common.join('\n') + '\n');
  log(`wordlist/common.txt   ${common.length} words  ${(fs.statSync(commonPath).size / 1024).toFixed(0)} KB`);

  // The sources are only needed at build time; shipping them would double the
  // cost of the feature for no benefit.
  rmrf(srcDir);
}

async function main() {
  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(VENDOR, { recursive: true });

  const manifest = { generated: new Date().toISOString(), packages: [], ocrLanguages: LANGS };

  for (const pkg of PACKAGES) {
    console.log(`\n▸ ${pkg.name}@${pkg.version}  (${pkg.license})`);
    const tgz = pack(pkg.name, pkg.version);
    const ex = path.join(TMP, 'x', pkg.name.replace(/[@/]/g, '_'));
    rmrf(ex);
    fs.mkdirSync(ex, { recursive: true });
    execFileSync('tar', ['xzf', tgz, '-C', ex]);
    const base = path.join(ex, 'package');
    for (const [from, to] of pkg.copy) {
      const src = path.join(base, from);
      if (!fs.existsSync(src)) {
        console.warn(`   ! missing ${from} in ${pkg.name} — skipped`);
        continue;
      }
      copyPath(src, path.join(VENDOR, pkg.out, to));
      log(`${pkg.out}/${to}`);
    }
    manifest.packages.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      dir: `vendor/${pkg.out}`,
    });
  }

  buildWordlists();

  // ---- OCR language data (Apache-2.0, tesseract-ocr/tessdata_fast) ----
  console.log(
    `\n▸ ${TESSDATA_REPOS[QUALITY] || 'tessdata_best'}  (Apache-2.0)  langs: ${LANGS.join(', ')}`
  );
  const langDir = path.join(VENDOR, 'tessdata');
  fs.mkdirSync(langDir, { recursive: true });
  /**
   * The cache is keyed by quality, not just by filename.
   *
   * Keyed by filename alone, `--quality fast` over an existing `best` pack was
   * a silent no-op: the 12 MB file stayed, VERSIONS.json was rewritten to say
   * `tessdata_fast`, and the build shipped one pack while claiming the other.
   * That is the exact failure this project treats as unacceptable — a record
   * that disagrees with reality, with nothing raising a hand.
   */
  const stamp = path.join(langDir, '.quality');
  const cachedQuality = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : null;
  if (cachedQuality && cachedQuality !== QUALITY) {
    log(`quality changed (${cachedQuality} -> ${QUALITY}) — refetching language data`);
    for (const f of fs.readdirSync(langDir)) {
      if (f.endsWith('.traineddata.gz')) fs.rmSync(path.join(langDir, f));
    }
  }
  for (const lang of WITH_OSD ? [...LANGS, 'osd'] : LANGS) {
    const gzPath = path.join(langDir, `${lang}.traineddata.gz`);
    if (fs.existsSync(gzPath)) {
      log(`${lang}.traineddata.gz (cached, ${QUALITY})`);
      continue;
    }
    const url = `${TESSDATA_BASE}/${lang}.traineddata`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`   ! no traineddata for "${lang}" (${res.status}) — skipped`);
      continue;
    }
    const raw = Buffer.from(await res.arrayBuffer());
    // tesseract.js fetches `${langPath}/${lang}.traineddata.gz` and gunzips it.
    fs.writeFileSync(gzPath, zlib.gzipSync(raw, { level: 9 }));
    log(`${lang}.traineddata.gz  ${(fs.statSync(gzPath).size / 1e6).toFixed(2)} MB`);
  }
  fs.writeFileSync(stamp, QUALITY + '\n');
  await download(
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/LICENSE',
    path.join(langDir, 'LICENSE')
  ).catch(() => console.warn('   ! could not fetch tessdata LICENSE'));
  manifest.packages.push({
    name: TESSDATA_REPOS[QUALITY] || TESSDATA_REPOS.best,
    version: '4.1.0',
    license: 'Apache-2.0',
    dir: 'vendor/tessdata',
  });

  fs.writeFileSync(
    path.join(VENDOR, 'VERSIONS.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  rmrf(TMP);

  const size = execFileSync('du', ['-sh', VENDOR], { encoding: 'utf8' }).trim();
  console.log(`\n✓ vendor staged — ${size.split('\t')[0]} total`);
  console.log('  wrote vendor/VERSIONS.json');
}

main().catch((err) => {
  console.error('\n✗ vendor fetch failed:', err.message);
  process.exit(1);
});
