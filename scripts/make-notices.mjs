#!/usr/bin/env node
/**
 * Generates THIRD_PARTY_NOTICES.md from what is actually staged in vendor/.
 *
 * Apache-2.0 requires you to ship the license text and any NOTICE; MIT and
 * BSD-2 require the copyright line and license text. Generating this file from
 * the real vendor tree (rather than maintaining it by hand) means it cannot
 * drift out of date when a dependency is added or bumped.
 *
 *   node scripts/make-notices.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const OUT = path.join(ROOT, 'THIRD_PARTY_NOTICES.md');

const versionsPath = path.join(VENDOR, 'VERSIONS.json');
if (!fs.existsSync(versionsPath)) {
  console.error('vendor/VERSIONS.json is missing — run scripts/fetch-vendor.mjs first.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));

const HOMEPAGES = {
  'pdfjs-dist': 'https://github.com/mozilla/pdf.js',
  'tesseract.js': 'https://github.com/naptha/tesseract.js',
  'tesseract.js-core': 'https://github.com/naptha/tesseract.js-core',
  turndown: 'https://github.com/mixmark-io/turndown',
  'turndown-plugin-gfm': 'https://github.com/mixmark-io/turndown-plugin-gfm',
  marked: 'https://github.com/markedjs/marked',
  mammoth: 'https://github.com/mwilliamson/mammoth.js',
  jszip: 'https://github.com/Stuk/jszip',
  papaparse: 'https://github.com/mholt/PapaParse',
  'js-yaml': 'https://github.com/nodeca/js-yaml',
  dompurify: 'https://github.com/cure53/DOMPurify',
  '@mozilla/readability': 'https://github.com/mozilla/readability',
  tessdata_fast: 'https://github.com/tesseract-ocr/tessdata_fast',
};

function licenseTextFor(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return null;
  const candidates = fs
    .readdirSync(abs)
    .filter((f) => /^LICEN[CS]E/i.test(f))
    .sort();
  for (const file of candidates) {
    const text = fs.readFileSync(path.join(abs, file), 'utf8').trim();
    if (text) return { file, text };
  }
  return null;
}

const APACHE_SUMMARY = `
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
these files except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.
`.trim();

const lines = [];
lines.push('# Third-party notices');
lines.push('');
lines.push(
  'Sumcheck bundles the following third-party components. Each is redistributed',
  'under a permissive license that allows commercial use, modification and',
  'redistribution in a proprietary product, provided this notice ships with it.',
  ''
);
lines.push(`Generated from \`vendor/VERSIONS.json\` on ${new Date().toISOString().slice(0, 10)}.`);
lines.push('');
lines.push('| Component | Version | License |');
lines.push('| --- | --- | --- |');
for (const pkg of manifest.packages) {
  const link = HOMEPAGES[pkg.name] ? `[${pkg.name}](${HOMEPAGES[pkg.name]})` : pkg.name;
  lines.push(`| ${link} | ${pkg.version} | ${pkg.license} |`);
}
lines.push('');

for (const pkg of manifest.packages) {
  lines.push('---');
  lines.push('');
  lines.push(`## ${pkg.name} ${pkg.version}`);
  lines.push('');
  lines.push(`License: ${pkg.license}`);
  if (HOMEPAGES[pkg.name]) lines.push(`Source: ${HOMEPAGES[pkg.name]}`);
  lines.push(`Bundled at: \`${pkg.dir}\``);
  lines.push('');
  const license = licenseTextFor(pkg.dir);
  if (license) {
    lines.push('```');
    lines.push(license.text);
    lines.push('```');
  } else {
    lines.push(APACHE_SUMMARY);
  }
  lines.push('');
}

fs.writeFileSync(OUT, lines.join('\n'));
console.log(`✓ THIRD_PARTY_NOTICES.md written (${manifest.packages.length} components)`);
