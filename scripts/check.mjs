#!/usr/bin/env node
/**
 * Pre-publish checks. Catches the mistakes that get a Chrome Web Store
 * submission rejected or a "Load unpacked" broken:
 *
 *   - manifest points at files that do not exist
 *   - a page references a script/stylesheet that is not in the package
 *   - anything tries to load code or data from the network at runtime
 *   - vendor/ is missing or out of sync with VERSIONS.json
 *
 *   node scripts/check.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INCLUDE } from './package-contents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------------------------------------------------------- manifest */

const manifest = JSON.parse(read('manifest.json'));
const manifestRefs = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean);

for (const ref of manifestRefs) {
  if (!exists(ref)) problems.push(`manifest.json references a missing file: ${ref}`);
}
if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if (!/wasm-unsafe-eval/.test(manifest.content_security_policy?.extension_pages || '')) {
  problems.push("extension_pages CSP must allow 'wasm-unsafe-eval' or OCR cannot start");
}

/* ------------------------------------------------------------------- pages */

const pages = ['src/app/app.html', 'src/popup/popup.html'];
for (const page of pages) {
  if (!exists(page)) {
    problems.push(`missing page: ${page}`);
    continue;
  }
  const html = read(page);
  const dir = path.dirname(page);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(https?:|data:|#)/.test(ref)) {
      problems.push(`${page} loads a remote or inline resource: ${ref}`);
      continue;
    }
    const resolved = path.normalize(path.join(dir, ref));
    if (!exists(resolved)) problems.push(`${page} references a missing file: ${ref}`);
  }
}

/* ------------------------------------------------------------- source scan */

const sourceFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.(js|mjs)$/.test(entry.name)) sourceFiles.push(rel);
  }
})('src');

const REMOTE_PATTERN = /(?:fetch|import)\(\s*['"`]https?:\/\//;
const syntaxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumcheck-syntax-'));

for (const file of sourceFiles) {
  const code = read(file);
  if (REMOTE_PATTERN.test(code)) {
    problems.push(`${file} loads something over the network at runtime`);
  }
  for (const match of code.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
    const resolved = path.normalize(path.join(path.dirname(file), match[1]));
    if (!exists(resolved)) problems.push(`${file} imports a missing module: ${match[1]}`);
  }
  // Parse every file as an ES module. The extension pages load these directly,
  // so a syntax error here is a blank UI with a console message nobody sees.
  const temp = path.join(syntaxDir, file.replace(/[\\/]/g, '_') + '.mjs');
  fs.writeFileSync(temp, code);
  try {
    execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe' });
  } catch (err) {
    const detail = String(err.stderr || err.message).split('\n').find((l) => /Error/.test(l));
    problems.push(`${file} has a syntax error: ${detail || 'see node --check'}`);
  }
}
fs.rmSync(syntaxDir, { recursive: true, force: true });

/* ------------------------------------------------------------------ vendor */

if (!exists('vendor/VERSIONS.json')) {
  problems.push('vendor/ is not staged — run: npm run vendor');
} else {
  const versions = JSON.parse(read('vendor/VERSIONS.json'));
  for (const pkg of versions.packages) {
    if (!exists(pkg.dir)) problems.push(`vendor entry missing on disk: ${pkg.dir}`);
  }
  const required = [
    'vendor/pdfjs/pdf.min.mjs',
    'vendor/pdfjs/pdf.worker.min.mjs',
    'vendor/tesseract/worker.min.js',
    'vendor/tesseract/tesseract-core-simd-lstm.js',
    'vendor/tesseract/tesseract-core-simd-lstm.wasm',
    'vendor/turndown/turndown.js',
    'vendor/jszip/jszip.min.js',
  ];
  for (const file of required) if (!exists(file)) problems.push(`missing vendored file: ${file}`);

  const langs = fs.existsSync(path.join(ROOT, 'vendor/tessdata'))
    ? fs.readdirSync(path.join(ROOT, 'vendor/tessdata')).filter((f) => f.endsWith('.traineddata.gz'))
    : [];
  if (!langs.length) problems.push('no OCR language data in vendor/tessdata');
  else notes.push(`OCR languages: ${langs.map((l) => l.replace('.traineddata.gz', '')).join(', ')}`);

  /**
   * The pack on disk must be the pack VERSIONS.json claims.
   *
   * These can disagree without anyone noticing: the fetcher used to key its
   * cache on filename alone, so asking for a different quality rewrote the
   * manifest and kept the old data. A build that ships one pack while its
   * notices name another is both an accuracy problem and a licensing one.
   */
  const stampPath = path.join(ROOT, 'vendor/tessdata/.quality');
  const versionsPath = path.join(ROOT, 'vendor/VERSIONS.json');
  if (langs.length && fs.existsSync(versionsPath)) {
    const REPO_FOR = { fast: 'tessdata_fast', standard: 'tessdata', best: 'tessdata_best' };
    const declared = (JSON.parse(fs.readFileSync(versionsPath, 'utf8')).packages || []).find((p) =>
      String(p.dir) === 'vendor/tessdata'
    );
    if (!fs.existsSync(stampPath)) {
      problems.push(
        'vendor/tessdata/.quality is missing — re-run "npm run build" so the shipped pack is identifiable'
      );
    } else {
      const stamped = fs.readFileSync(stampPath, 'utf8').trim();
      const expected = REPO_FOR[stamped];
      if (!expected) {
        problems.push(`vendor/tessdata/.quality says "${stamped}", which is not a known quality`);
      } else if (declared && declared.name !== expected) {
        problems.push(
          `vendor/tessdata holds ${stamped} data but VERSIONS.json declares ${declared.name} — ` +
            'delete vendor/tessdata/*.traineddata.gz and re-run "npm run build"'
        );
      } else {
        notes.push(`OCR pack: ${expected}`);
      }
    }
  }

  // The core must sit beside the worker: Emscripten resolves its .wasm against
  // the worker's own URL, not against corePath.
  const workerDir = path.join(ROOT, 'vendor/tesseract');
  if (
    fs.existsSync(path.join(workerDir, 'worker.min.js')) &&
    !fs.existsSync(path.join(workerDir, 'tesseract-core-simd-lstm.wasm'))
  ) {
    problems.push('tesseract core .wasm must live next to worker.min.js');
  }
}

if (!exists('THIRD_PARTY_NOTICES.md')) {
  problems.push('THIRD_PARTY_NOTICES.md is missing — run: npm run notices');
}

/* ------------------------------------------------------------------ report */

/* ------------------------------------------------------------------ i18n */

/**
 * The message catalogue, and whether the interface actually uses it.
 *
 * Two failures are worth catching before the store does. A `__MSG_` placeholder
 * with no matching message ships an extension literally called
 * "__MSG_appName__". A `data-i18n` key with a typo renders an empty element,
 * which is worse than an untranslated one because nothing is visibly wrong
 * until a user sees a blank button.
 */
const LOCALE = manifest.default_locale;
let messages = {};
if (!LOCALE) {
  problems.push('manifest has no default_locale, so _locales/ is never consulted');
} else {
  const cataloguePath = `_locales/${LOCALE}/messages.json`;
  if (!fs.existsSync(path.join(ROOT, cataloguePath))) {
    problems.push(`${cataloguePath} is missing but manifest declares default_locale "${LOCALE}"`);
  } else {
    messages = JSON.parse(read(cataloguePath));
    notes.push(`UI messages: ${Object.keys(messages).length} in ${LOCALE}`);
  }
}

const missingMessage = (key) => !Object.prototype.hasOwnProperty.call(messages, key);

for (const [field, value] of [
  ['name', manifest.name],
  ['description', manifest.description],
  ['commands._execute_action.description', manifest.commands?._execute_action?.description],
]) {
  const match = /^__MSG_(.+)__$/.exec(String(value ?? ''));
  if (match && missingMessage(match[1])) {
    problems.push(`manifest ${field} refers to message "${match[1]}", which is not in _locales/${LOCALE}`);
  }
}

/**
 * Untranslated text still sitting in the UI pages.
 *
 * Limits, stated plainly: this is a regex over markup, not a parser. It sees
 * text directly between tags on one line and nothing else — it cannot see
 * strings built in JavaScript, text in attributes other than the ones tagged
 * with `data-i18n-attr`, or text split across lines by an inline element. It is
 * a regression guard for the pages as they are shaped today, not a proof of
 * coverage. `src/core/` is deliberately out of scope: conversion warnings and
 * `SUMCHECK:` markers are product output that ships inside converted documents
 * and stays English.
 */
const UI_PAGES = ['src/app/app.html', 'src/popup/popup.html'];
const IGNORED_TAGS = new Set(['script', 'style', 'title', 'code', 'kbd', 'option']);
for (const page of UI_PAGES) {
  const html = read(page);
  const untranslated = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)([^>]*)>([^<>]{2,})</g)) {
    const [, tag, attrs, text] = match;
    const trimmed = text.trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) continue;
    if (IGNORED_TAGS.has(tag) || attrs.includes('data-i18n')) continue;
    untranslated.push(trimmed.slice(0, 40));
  }
  if (untranslated.length) {
    problems.push(
      `${page} has ${untranslated.length} untranslated string(s): ${JSON.stringify(untranslated.slice(0, 3))}` +
        ' — tag with data-i18n and add to _locales/'
    );
  }
  for (const match of html.matchAll(/data-i18n(?:-title)?="([^":]+)"/g)) {
    if (missingMessage(match[1])) problems.push(`${page} uses message "${match[1]}", which is not in _locales/${LOCALE}`);
  }
  for (const match of html.matchAll(/data-i18n-(?:attr|emphasis)="([^"]+)"/g)) {
    for (const pair of match[1].split(',')) {
      const key = pair.split(':').pop().trim();
      if (key && missingMessage(key)) problems.push(`${page} uses message "${key}", which is not in _locales/${LOCALE}`);
    }
  }
}

/** Message keys the interface no longer uses. Not fatal; just dead weight. */
{
  const used = new Set();
  for (const page of UI_PAGES) {
    for (const m of read(page).matchAll(/data-i18n[a-z-]*="([^"]+)"/g)) {
      // Both halves of `attribute:key` and `sentence:word` count as used —
      // taking only the last part reported the sentence key as dead.
      for (const pair of m[1].split(',')) {
        for (const part of pair.split(':')) used.add(part.trim());
      }
    }
  }
  for (const file of ['src/app/app.js', 'src/popup/popup.js', 'src/background/service-worker.js']) {
    for (const m of read(file).matchAll(/\b(?:t|getMessage)\(\s*'([^']+)'/g)) used.add(m[1]);
  }
  for (const value of [manifest.name, manifest.short_name, manifest.description, manifest.commands?._execute_action?.description]) {
    const match = /^__MSG_(.+)__$/.exec(String(value ?? ''));
    if (match) used.add(match[1]);
  }
  const unused = Object.keys(messages).filter((k) => !used.has(k));
  if (unused.length) notes.push(`unused messages (${unused.length}): ${unused.slice(0, 5).join(', ')}`);
}


/**
 * Everything the manifest depends on must actually be packaged. `_locales/`
 * was declared in the manifest and left out of the zip, which produces a build
 * that installs nowhere and fails no test.
 */
{
  const needed = ['LICENSE', 'NOTICE'];
  if (manifest.default_locale) needed.push('_locales');
  if (manifest.background?.service_worker) needed.push(manifest.background.service_worker.split('/')[0]);
  if (manifest.action?.default_popup) needed.push(manifest.action.default_popup.split('/')[0]);
  for (const entry of new Set(needed)) {
    if (!INCLUDE.includes(entry)) {
      problems.push(`the manifest needs "${entry}" but scripts/package-contents.mjs does not ship it`);
    } else if (!fs.existsSync(path.join(ROOT, entry))) {
      problems.push(`the manifest needs "${entry}" but it does not exist`);
    }
  }
}

/**
 * Things that must never reach the package.
 *
 * The include list is an allowlist, so this is belt-and-braces — but the
 * wordlist tier JSONs are the interesting case: they live *inside* `vendor/`,
 * which is included wholesale, and are deleted by the build step rather than
 * excluded by the packager. If that deletion ever stops happening they ship
 * silently and roughly double the cost of the lexicon feature.
 */
{
  const mustNotShip = [
    ['vendor/wordlist/src', 'wordlist build sources — deleted by fetch-vendor after the lists are built'],
    ['store', 'store listing sources'],
    ['test', 'test fixtures and harness'],
    ['scripts', 'build scripts'],
    ['docs', 'internal documentation'],
    ['dist', 'previous packages'],
  ];
  for (const [entry, why] of mustNotShip) {
    const top = entry.split('/')[0];
    const insideIncluded = INCLUDE.includes(top) && entry.includes('/');
    if (INCLUDE.includes(entry)) {
      problems.push(`"${entry}" is in the package include list but must not ship (${why})`);
    } else if (insideIncluded && fs.existsSync(path.join(ROOT, entry))) {
      problems.push(`"${entry}" still exists inside packaged "${top}/" and must not ship (${why})`);
    }
  }
}

for (const note of notes) console.log(`  ${note}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// The manifest name is a message placeholder; show what it resolves to.
const displayName = String(manifest.name).replace(/^__MSG_(.+)__$/, (_, k) => messages[k]?.message ?? k);
console.log(`\n✓ ${displayName} ${manifest.version} looks ready to package`);
