#!/usr/bin/env node
/**
 * Builds the Chrome Web Store upload: dist/sumcheck-<version>.zip containing
 * only what the extension needs at runtime.
 *
 *   node scripts/package.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INCLUDE, EXCLUDE } from './package-contents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');




const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const zipName = `sumcheck-${manifest.version}.zip`;
const zipPath = path.join(DIST, zipName);

for (const entry of INCLUDE) {
  if (!fs.existsSync(path.join(ROOT, entry))) {
    console.error(`✗ missing ${entry} — run "npm run build" first`);
    process.exit(1);
  }
}

fs.mkdirSync(DIST, { recursive: true });
fs.rmSync(zipPath, { force: true });

execFileSync('zip', ['-q', '-r', '-X', zipPath, ...INCLUDE, '-x', ...EXCLUDE], { cwd: ROOT });

const size = fs.statSync(zipPath).size;
console.log(`✓ dist/${zipName}  ${(size / 1024 / 1024).toFixed(1)} MB`);
if (size > 100 * 1024 * 1024) {
  console.warn('  ! over the Chrome Web Store 100 MB upload limit');
}
console.log('\nUpload at https://chrome.google.com/webstore/devconsole');
