/**
 * Converts every document in the mounted corpus and reports what the converter
 * itself is unsure about, plus any expectations supplied by the operator.
 *
 * The corpus is served read-only from wherever it already lives — nothing is
 * copied, which matters when the documents contain personal data.
 *
 * Driven by scripts/audit.mjs; results are left on window.__audit.
 */

import { convertFile } from '../src/core/convert.js';
import { terminateOcr, ocrDiagnostics, resetOcrDiagnostics } from '../src/core/ocr.js';

const params = new URLSearchParams(location.search);
const DUMP_WORDS = params.get('dumpWords') === '1';
const OCR_PARAMETERS = params.get('ocrParameters') === 'none' ? 'none' : 'default';

/**
 * The boilerplate tokens under dispute. A page containing any of them gets its
 * raster saved, so the same pixels can be handed to another engine.
 */
const DISPUTED_TOKENS = [
  'Tax', 'ID:', '04-3642199', 'Items', 'www.cms.gov/nosurprises', 'included', 'Code', 'U.S.',
];

const status = document.getElementById('status');
const rows = document.getElementById('rows');

window.__audit = null;
window.__auditDone = false;

/** Structural checks every document gets, independent of any expectations. */
function inspect(name, md, result) {
  const findings = [];
  const lines = md.split('\n');

  // A bare amount inside a table that also carries "$" amounts.
  for (const line of lines.filter((l) => /^\|/.test(l))) {
    const cells = line.split('|').map((c) => c.trim());
    const dollars = cells.filter((c) => /^\$[\d,]+\.\d{2}$/.test(c)).length;
    for (const cell of cells) {
      if (dollars && /^[\d,]+\.\d{2}$/.test(cell)) {
        findings.push({ type: 'bare-currency', detail: cell });
      }
    }
  }

  // A label that kept its colon but lost its value, with nothing following it.
  lines.forEach((line, i) => {
    const label = /^#{0,6}\s*([A-Z][^:]{3,60}):\s*$/.exec(line.trim());
    if (!label) return;
    const next = (lines[i + 1] || '').trim() || (lines[i + 2] || '').trim();
    const hasValue = /[\d$]/.test(next) || /SUMCHECK/.test(line);
    if (!hasValue) findings.push({ type: 'label-without-value', detail: label[1] });
  });

  if (!/^\|/m.test(md) && /^```/m.test(md) === false) {
    const numbers = (md.match(/\$[\d,]+\.\d{2}/g) || []).length;
    if (numbers >= 4) findings.push({ type: 'no-table-but-many-amounts', detail: `${numbers} amounts` });
  }

  return {
    name,
    bytes: md.length,
    ocr: Boolean(result.meta.ocr || result.meta.ocrPages),
    dpi: result.meta.ocrDpi ?? null,
    confidenceMean: result.meta.ocrConfidenceMean ?? null,
    confidenceMin: result.meta.ocrConfidenceMin ?? null,
    flaggedWords: result.meta.ocrFlaggedFields ?? 0,
    unreadableRegions: result.meta.ocrUnreadableRegions ?? 0,
    reviewFlags: result.review?.length ?? 0,
    reviewMessages: (result.review || []).map((r) => r.message),
    tables: (md.match(/^\|.*\|$/gm) || []).length ? 1 : 0,
    warnings: result.warnings,
    findings,
    markdown: md,
  };
}

/**
 * Flatten one document's OCR pages into the dump the work order asks for:
 * every word as it left `toLines()`, plus the raster it was read from for any
 * page carrying a disputed token.
 */
function dumpFor(pages) {
  const words = [];
  const rasters = [];
  for (const page of pages) {
    let carriesDisputed = false;
    for (const line of page.lines) {
      for (const word of line.words || []) {
        words.push({
          page: page.page,
          text: word.text,
          confidence: word.confidence,
          bbox: { x: word.x, y: word.top, x2: word.x2, y2: word.bottom },
          source: line.source || 'primary',
        });
        if (DISPUTED_TOKENS.includes(word.text)) carriesDisputed = true;
      }
    }
    if (carriesDisputed && page.raster) {
      rasters.push({ page: page.page, dpi: page.dpi, dataUrl: page.raster });
    }
  }
  return {
    wordDump: {
      parameters: pages[0]?.parameters ?? OCR_PARAMETERS,
      dpi: pages[0]?.dpi ?? null,
      sourceDpi: pages[0]?.sourceDpi ?? null,
      diagnostics: ocrDiagnostics(),
      // The unread-ink rectangles and what the contrast re-read found inside
      // them. This is the regression baseline for the detector.
      rescue: pages.map((p) => ({ page: p.page, ...(p.rescue || {}) })),
      words,
    },
    rasters,
  };
}

/**
 * PSM probe: read already-rendered page rasters at several page-segmentation
 * modes. The input pixels are fixed, so any difference in the scores is the
 * engine's configuration and nothing else — which is the only way to tell
 * "our renderer makes different pixels" apart from "our engine reads them
 * differently".
 */
async function runPsmProbe(files) {
  const { recognize, getOcrWorker } = await import('../src/core/ocr.js');
  const images = files.filter((f) => /\.png$/i.test(f));
  const out = [];

  for (let i = 0; i < images.length; i++) {
    const name = images[i];
    status.textContent = `probing ${i + 1} of ${images.length} — ${name}`;
    const blob = await (await fetch(`/corpus/${encodeURIComponent(name)}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);

    const modes = {};
    for (const psm of ['3', '6']) {
      const worker = await getOcrWorker('eng');
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { lines } = await recognize(canvas, { lang: 'eng', dpi: 192, parameters: 'none' });
      const words = lines.flatMap((l) => l.words || []);
      modes[`psm${psm}`] = Object.fromEntries(
        DISPUTED_TOKENS.map((t) => [t, words.filter((w) => w.text === t).map((w) => w.confidence)])
      );
    }
    out.push({ name, width: bitmap.width, height: bitmap.height, modes });
    canvas.width = canvas.height = 0;
  }
  return out;
}

async function run() {
  const files = await (await fetch('/corpus-list.json')).json();

  if (params.get('probe') === 'psm') {
    window.__audit = await runPsmProbe(files);
    await terminateOcr();
    window.__auditDone = true;
    status.textContent = `psm probe done — ${window.__audit.length} raster(s)`;
    return;
  }
  if (!files.length) {
    status.textContent = 'no corpus mounted — set SUMCHECK_CORPUS to a directory';
    window.__audit = [];
    window.__auditDone = true;
    return;
  }

  const expectations = normalizeExpectations(
    await fetch('/corpus-expectations.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  );

  const out = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    status.textContent = `converting ${i + 1} of ${files.length} — ${name}`;
    try {
      const bytes = new Uint8Array(
        await (await fetch(`/corpus/${encodeURIComponent(name)}`)).arrayBuffer()
      );
      resetOcrDiagnostics();
      const pages = [];
      const result = await convertFile(
        { bytes, name },
        { outputs: ['md'], ocrParameters: OCR_PARAMETERS },
        DUMP_WORDS
          ? {
              wantRaster: true,
              onOcrPage: (page) => pages.push(page),
            }
          : {}
      );
      const md = result.outputs.find((o) => o.format === 'md').content;
      const record = inspect(name, md, result);
      record.expected = checkExpectations(name, md, expectations);
      if (DUMP_WORDS) Object.assign(record, dumpFor(pages));
      out.push(record);
    } catch (err) {
      out.push({ name, error: err.message, findings: [], expected: [], warnings: [] });
    }
    const row = document.createElement('div');
    row.className = 'row';
    const last = out[out.length - 1];
    const problems = (last.findings?.length || 0) + (last.expected?.filter((e) => !e.ok).length || 0);
    row.textContent = `${name} — ${last.error ? 'ERROR ' + last.error : `${problems} finding(s), confidence ${last.confidenceMean ?? 'n/a'}`}`;
    if (problems || last.error) row.className += ' bad';
    rows.appendChild(row);
  }

  await terminateOcr();
  window.__audit = out;
  window.__auditDone = true;
  status.textContent = `done — ${out.length} documents`;
}

/**
 * Ground-truth files come in whatever shape the person auditing found natural.
 * Rather than dictate one, accept the plausible ones:
 *
 *   { "file.pdf": { "mustContain": [...], "mustNotMatch": [...] } }   explicit
 *   { "file.pdf": { "address": "14835 Southwest Fwy", "total": "$600.00" } }
 *   { "file.pdf": { "line_items": [{ "code": "74183", "charge": "$400" }] } }
 *   [ { "file": "file.pdf", "field": "address", "expected": "14835 …" } ]
 *
 * Anything that is not an explicit rule set is flattened to its leaf values and
 * treated as "this string must appear in the conversion", which is the question
 * a ground-truth file is actually asking.
 */
function normalizeExpectations(raw) {
  if (!raw) return null;
  const out = {};

  const addContains = (file, value, label) => {
    out[file] = out[file] || { mustContain: [], labels: {} };
    const text = String(value).trim();
    if (!text || text === 'null' || text === 'undefined') return;
    out[file].mustContain.push(text);
    if (label) out[file].labels[text] = label;
  };

  const flatten = (file, value, path) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => flatten(file, v, `${path}[${i}]`));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) flatten(file, v, path ? `${path}.${k}` : k);
    } else if (typeof value !== 'boolean') {
      addContains(file, value, path);
    }
  };

  if (Array.isArray(raw)) {
    for (const row of raw) {
      const file = row.file || row.name || row.document || row.filename || '*';
      const value = row.expected ?? row.value ?? row.text;
      if (value !== undefined) addContains(file, value, row.field || row.key);
      else flatten(file, row, '');
    }
    return out;
  }

  for (const [file, value] of Object.entries(raw)) {
    const explicit =
      value && typeof value === 'object' && !Array.isArray(value) &&
      ['mustContain', 'mustNotContain', 'mustNotMatch'].some((k) => k in value);
    if (explicit) out[file] = { ...value, labels: {} };
    else flatten(file, value, '');
  }
  return out;
}

/** Match a corpus filename against a ground-truth key, tolerating extensions. */
function keysFor(name, expectations) {
  const stem = name.replace(/\.[^.]+$/, '');
  return Object.keys(expectations).filter(
    (k) => k === '*' || k === name || k.replace(/\.[^.]+$/, '') === stem
  );
}

function checkExpectations(name, md, expectations) {
  if (!expectations) return [];
  const results = [];
  for (const key of keysFor(name, expectations)) {
    const rules = expectations[key];
    for (const needle of rules.mustContain || []) {
      const label = rules.labels?.[needle];
      results.push({
        rule: label ? `${label} = ${JSON.stringify(needle)}` : `contains ${JSON.stringify(needle)}`,
        ok: md.includes(needle),
      });
    }
    for (const needle of rules.mustNotContain || []) {
      results.push({ rule: `omits ${JSON.stringify(needle)}`, ok: !md.includes(needle) });
    }
    for (const pattern of rules.mustNotMatch || []) {
      results.push({ rule: `no match /${pattern}/`, ok: !new RegExp(pattern, 'm').test(md) });
    }
  }
  return results;
}

run().catch((err) => {
  status.textContent = `audit failed: ${err.message}`;
  window.__audit = [];
  window.__auditDone = true;
});
