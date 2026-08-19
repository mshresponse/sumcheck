#!/usr/bin/env node
/**
 * Run Sumcheck over a directory of real documents and report what it is unsure
 * about — plus any expectations you supply.
 *
 *   node scripts/audit.mjs ~/corpus
 *   node scripts/audit.mjs ~/corpus --expect expectations.json --out report
 *
 * The corpus is served read-only from where it already lives; nothing is copied
 * and nothing leaves the machine. Use this to re-run an audit batch after a
 * change and diff the result.
 *
 * expectations.json:
 *   {
 *     "*":            { "mustContain": ["14835 Southwest Fwy"],
 *                       "mustNotMatch": ["\\|\\s*[\\d,]+\\.\\d{2}\\s*\\|"] },
 *     "file (49).pdf":{ "mustContain": ["3310 Richmond Ave"] }
 *   }
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8946;
const DEBUG_PORT = 9336;

const args = process.argv.slice(2);
const corpus = args.find((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};

if (!corpus || !fs.existsSync(corpus)) {
  console.error('Usage: node scripts/audit.mjs <directory-of-documents> [--expect file.json] [--out name]');
  process.exit(1);
}
const outName = flag('--out', 'audit');
const expectPath = flag('--expect', null);

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('✗ No Chrome/Chromium found. Set CHROME_PATH.');
  process.exit(1);
}

const children = [];
const cleanup = () => children.forEach((c) => { try { c.kill('SIGKILL'); } catch {} });
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reports go next to the conversions they describe, not into the repository.
 * An audit of a sensitive corpus should never scatter derived content outside
 * the directory the operator nominated for it.
 */
function writeReport(name, contents) {
  const emit = flag('--emit', null);
  // In a subdirectory, not beside the conversions: a report is Markdown too,
  // and tools that glob *.md over the output would otherwise read the report as
  // if it were a converted document.
  const dir = emit ? path.join(emit, 'reports') : ROOT;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  console.log(`\nWrote ${file}`);
}

async function waitFor(fn, { timeout = 30000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(250);
  }
}

async function main() {
  // Expectations are served from the package root so the page can fetch them.
  const expectServed = path.join(ROOT, 'corpus-expectations.json');
  if (expectPath) fs.copyFileSync(expectPath, expectServed);
  else fs.writeFileSync(expectServed, '{}');

  const server = spawn('node', [path.join(ROOT, 'scripts/dev-server.mjs'), String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, SUMCHECK_CORPUS: path.resolve(corpus) },
  });
  children.push(server);
  const url = `http://localhost:${PORT}/test/audit.html`;
  await waitFor(() => fetch(url).then((r) => r.ok), { label: 'the dev server' });

  const files = await (await fetch(`http://localhost:${PORT}/corpus-list.json`)).json();
  console.log(`Auditing ${files.length} document(s) from ${path.resolve(corpus)}\n`);

  const query = new URLSearchParams();
  if (args.includes('--dump-words')) query.set('dumpWords', '1');
  if (args.includes('--probe-psm')) query.set('probe', 'psm');
  const ocrParameters = flag('--ocr-parameters', null);
  if (ocrParameters) query.set('ocrParameters', ocrParameters);
  const pageUrl = query.toString() ? `${url}?${query}` : url;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sumcheck-audit-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    pageUrl,
  ], { stdio: 'ignore' });
  children.push(chrome);

  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    return list.find((t) => t.type === 'page' && t.url.includes('audit.html'));
  }, { label: 'the audit page' });

  const results = await evaluate(target.webSocketDebuggerUrl, files.length);

  // Optionally keep the conversions, so a ground-truth scorer can run over them
  // and so two builds can be diffed file by file.
  const emit = flag('--emit', null);
  if (emit) {
    fs.mkdirSync(emit, { recursive: true });
    let dumps = 0;
    let rasters = 0;
    for (const doc of results) {
      const stem = doc.name.replace(/\.[^.]+$/, '');
      if (doc.markdown) fs.writeFileSync(path.join(emit, `${stem}.md`), doc.markdown);
      // Word dumps and page rasters are derived from the source documents and
      // carry the same personal data, so they stay in the corpus enclave.
      if (doc.wordDump) {
        fs.writeFileSync(
          path.join(emit, `${stem}.words.json`),
          JSON.stringify(doc.wordDump, null, 1)
        );
        dumps++;
      }
      for (const raster of doc.rasters || []) {
        const base64 = String(raster.dataUrl).replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(
          path.join(emit, `${stem}.p${raster.page}.png`),
          Buffer.from(base64, 'base64')
        );
        rasters++;
      }
    }
    console.log(
      `Wrote ${results.filter((d) => d.markdown).length} markdown file(s)` +
        (dumps ? `, ${dumps} word dump(s)` : '') +
        (rasters ? `, ${rasters} page raster(s)` : '') +
        ` to ${emit}\n`
    );
  }

  report(results);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(expectServed, { force: true });
  cleanup();
  process.exit(process.exitCode || 0);
}

function evaluate(wsUrl, fileCount) {
  // Scanned pages are slow; give the batch a generous ceiling.
  const budgetMs = Math.max(120_000, fileCount * 20_000);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`the audit did not finish within ${Math.round(budgetMs / 1000)}s`));
    }, budgetMs + 30_000);

    socket.addEventListener('error', () => reject(new Error('devtools socket error')));
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          awaitPromise: true,
          returnByValue: true,
          expression: `(async () => {
            const deadline = Date.now() + ${budgetMs};
            while (!window.__auditDone && Date.now() < deadline) {
              await new Promise(r => setTimeout(r, 500));
            }
            return window.__audit || [];
          })()`,
        },
      }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) return reject(new Error(message.error.message));
      resolve(message.result?.result?.value || []);
    });
  });
}

/**
 * How long the corpus took, ours to quote.
 *
 * The Docling bench extrapolated ~14 minutes for the 1,349-page guide and then
 * declined to compare, because our own time for the same work had never been
 * measured — a figure with no denominator is not a comparison in either
 * direction. Recorded here so the next bench has one.
 */
function timingSummary(results) {
  const timed = results.filter((d) => Number.isFinite(d.ms));
  if (!timed.length) return '';
  const total = timed.reduce((n, d) => n + d.ms, 0);
  const pages = timed.reduce((n, d) => n + (d.pages || 0), 0);
  const each = timed.map((d) => d.ms).sort((a, b) => a - b);
  const middle = each[Math.floor(each.length / 2)];
  const slowest = timed.reduce((a, b) => (b.ms > a.ms ? b : a));
  return [
    `wall-clock ${formatMs(total)} for ${timed.length} document(s)` +
      (pages ? `, ${pages} page(s), ${perPage(total, pages)}` : ''),
    `  median ${formatMs(middle)} per document · slowest ${formatMs(slowest.ms)} (${slowest.name})`,
  ].join('\n');
}

/**
 * Per-page cost in a unit that survives the division. A text-layer PDF runs at
 * a few milliseconds a page and a scanned one at several seconds; one fixed
 * unit reports one of those two cases as 0.00.
 */
function perPage(ms, pages) {
  const each = ms / pages;
  return each < 100 ? `${each.toFixed(1)} ms/page` : `${(each / 1000).toFixed(2)} s/page`;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function report(results) {
  // The PSM probe returns a different shape: per-raster token scores per mode.
  if (results.length && results[0]?.modes) {
    const tokens = Object.keys(results[0].modes.psm3 || {});
    const gather = (mode, token) =>
      results.flatMap((r) => r.modes[mode]?.[token] || []).filter((v) => typeof v === 'number');
    const median = (v) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : null);
    console.log(`PSM probe over ${results.length} raster(s) — identical pixels, engine config varied\n`);
    console.log('token'.padEnd(26) + 'psm3 (default)'.padStart(15) + 'psm6 (reviewer)'.padStart(17));
    for (const token of tokens) {
      console.log(
        token.padEnd(26) +
          String(median(gather('psm3', token))).padStart(15) +
          String(median(gather('psm6', token))).padStart(17)
      );
    }
    writeReport('psm-probe.json', JSON.stringify(results, null, 2));
    return;
  }
  if (!results.length) {
    console.error('✗ no results — is the corpus directory readable?');
    process.exitCode = 1;
    return;
  }

  const lines = ['# Sumcheck corpus audit', ''];
  let clean = 0;
  const totals = {};

  for (const doc of results) {
    const failures = (doc.expected || []).filter((e) => !e.ok);
    const problems = (doc.findings?.length || 0) + failures.length;
    if (!problems && !doc.error) clean++;
    for (const f of doc.findings || []) totals[f.type] = (totals[f.type] || 0) + 1;
    if (failures.length) totals['expectation-failed'] = (totals['expectation-failed'] || 0) + failures.length;

    const expected = doc.expected || [];
    const mark = doc.error ? '✗' : problems ? '!' : '✓';
    const scored = expected.length ? ` · ground truth ${expected.length - failures.length}/${expected.length}` : '';
    const summary = doc.error
      ? `ERROR ${doc.error}`
      : `conf ${doc.confidenceMean ?? 'n/a'} · flagged ${doc.flaggedWords} · review ${doc.reviewFlags}${scored} · ${problems} finding(s)${doc.ms ? ` · ${formatMs(doc.ms)}` : ''}`;
    console.log(`${mark} ${doc.name}  ${summary}`);
    for (const f of doc.findings || []) console.log(`    ${f.type}: ${f.detail}`);
    for (const f of failures) console.log(`    MISSING  ${f.rule}`);

    lines.push(`## ${doc.name}`, '');
    if (doc.error) lines.push(`**Error:** ${doc.error}`, '');
    else {
      lines.push(
        `- OCR: ${doc.ocr ? `yes, ${doc.dpi} dpi` : 'no'}`,
        `- confidence: mean ${doc.confidenceMean ?? 'n/a'}, min ${doc.confidenceMin ?? 'n/a'}`,
        `- low-confidence words: ${doc.flaggedWords}`,
        `- unreadable regions: ${doc.unreadableRegions}`,
        `- validator flags: ${doc.reviewFlags}`,
        `- wall-clock: ${doc.ms ? formatMs(doc.ms) : 'not recorded'}${
          doc.pages ? ` for ${doc.pages} page(s), ${perPage(doc.ms, doc.pages)}` : ''
        }`,
        ''
      );
      for (const m of doc.reviewMessages || []) lines.push(`  - ${m}`);
      for (const f of doc.findings || []) lines.push(`  - **${f.type}**: ${f.detail}`);
      for (const f of failures) lines.push(`  - **expectation failed**: ${f.rule}`);
      lines.push('');
    }
  }

  const groundTruth = results.reduce(
    (acc, d) => {
      acc.total += (d.expected || []).length;
      acc.passed += (d.expected || []).filter((e) => e.ok).length;
      return acc;
    },
    { total: 0, passed: 0 }
  );

  const summaryLines = [
    '',
    timingSummary(results),
    `${clean}/${results.length} documents with no findings`,
    ...(groundTruth.total
      ? [`${groundTruth.passed}/${groundTruth.total} ground-truth values found (${
          Math.round((groundTruth.passed / groundTruth.total) * 100)
        }%)`]
      : []),
    ...Object.entries(totals).map(([k, v]) => `  ${k}: ${v}`),
  ];
  console.log(summaryLines.join('\n'));
  lines.splice(2, 0, ...summaryLines, '');

  writeReport(`${outName}-report.md`, lines.join('\n'));
  writeReport(`${outName}-results.json`, JSON.stringify(results, null, 2));
  if (Object.keys(totals).length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  cleanup();
  process.exit(1);
});
