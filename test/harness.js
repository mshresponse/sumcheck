/**
 * End-to-end conversion tests.
 *
 * Served by scripts/dev-server.mjs under the extension's real CSP, so this
 * exercises the same constraints the packaged extension runs under: no remote
 * code, no eval, no blob workers, wasm allowed.
 *
 * Results are also left on window.__results for automated inspection.
 */

import { convertFile } from '../src/core/convert.js';
import { terminateOcr } from '../src/core/ocr.js';
import { buildDiagnostics } from '../src/core/diagnostics.js';
import { DEFAULT_OPTIONS } from '../src/core/options.js';

const has = (needle) => (md) => md.includes(needle) || `missing ${JSON.stringify(needle)}`;
const lacks = (needle) => (md) => !md.includes(needle) || `should not contain ${JSON.stringify(needle)}`;
const matches = (re) => (md) => re.test(md) || `no match for ${re}`;

const CASES = [
  {
    file: 'sample.pdf',
    options: { outputs: ['md', 'json'] },
    checks: {
      'title from metadata': has('# Quarterly Field Report'),
      'heading from type size': has('## Summary of Findings'),
      'second heading': has('## Regional Results'),
      'paragraph lines merged': has('largest gains recorded in the eastern corridor. Latency remained'),
      'bullets became a list': matches(/^- Eastern corridor exceeded/m),
      'numbered list on page 2': matches(/^1\. Extend the eastern corridor pilot/m),
      'table reconstructed': matches(/\|\s*Region\s*\|/),
      'table row': matches(/\|\s*East\s*\|\s*18,420\s*\|\s*\+11%\s*\|/),
      'link annotation kept': has('https://example.com/methodology'),
      'page marker': has('<!-- page 2 -->'),
      'running footer removed': lacks('Page 1 of 2'),
      'front matter': matches(/^---\ntitle: Quarterly Field Report/),
      'author in front matter': has('author: Operations Team'),
      /**
       * The result header's numbers, carried as data (#3). Asserted here rather
       * than in the app, because the contract is that the number a pipeline reads
       * out of the JSON is the same number a person read on screen — one estimate,
       * computed once, not two that nearly agree.
       */
      'json stats carry size and token figures': (md, r) => {
        const doc = JSON.parse(r.outputs.find((o) => o.format === 'json').content);
        const stats = doc.stats || {};
        if (!(stats.source_bytes > 0)) return `source_bytes was ${stats.source_bytes}`;
        if (!(stats.estimated_tokens > 0)) return `estimated_tokens was ${stats.estimated_tokens}`;
        if (stats.token_estimate !== 'characters/4') return `token_estimate was ${stats.token_estimate}`;
        return true;
      },
      /**
       * The count is an estimate and every surface that shows it says so. A bare
       * number invites someone to plan a context window around it.
       */
      'the token figure names its estimator': (md, r) => {
        const doc = JSON.parse(r.outputs.find((o) => o.format === 'json').content);
        return Boolean(doc.stats?.token_estimate) || 'no estimator named beside the count';
      },
      /**
       * The scored output surface must not move for a display feature. The corpus
       * scorer reads Markdown front matter, so a new key there would be a
       * conversion change wearing a UI change's clothes.
       */
      'markdown front matter gained no keys': (md) => {
        const front = /^---\n([\s\S]*?)\n---/.exec(md);
        if (!front) return 'no front matter';
        const keys = front[1].split('\n').map((l) => l.split(':')[0].trim());
        const unexpected = keys.filter((k) => /bytes|token|size|estimate/i.test(k));
        return !unexpected.length || `front matter gained ${JSON.stringify(unexpected)}`;
      },
'json blocks': (md, r) => {
        const doc = JSON.parse(r.outputs.find((o) => o.format === 'json').content);
        return (
          (doc.schema === 'sumcheck.document/v1' &&
            doc.blocks.some((b) => b.type === 'table') &&
            doc.blocks.some((b) => b.type === 'heading' && b.level === 2) &&
            doc.blocks.some((b) => b.page === 2)) ||
          `unexpected JSON shape (${doc.blocks.length} blocks)`
        );
      },
    },
  },
  {
    file: 'sample.xlsx',
    checks: {
      'sheet heading': has('## Revenue'),
      'second sheet': has('## Notes'),
      'header row': matches(/\|\s*Quarter\s*\|\s*Region\s*\|\s*Revenue\s*\|\s*Closed\s*\|/),
      'numbers preserved': has('18420.5'),
      'date serial decoded': has('2024-04-01'),
      'percent format applied': has('42.1%'),
      'inline string sheet': has('Margin held at 42%.'),
    },
  },
  {
    file: 'sample.pptx',
    checks: {
      'slide title': has('## Platform Review'),
      'second slide': has('## Reliability'),
      'bullets': has('- **Headline numbers**'),
      'nested bullet': matches(/\n\s+- Traffic up 18%/),
      'speaker notes': has('Remember to mention the migration window.'),
      'slide table': matches(/\|\s*Uptime\s*\|\s*99\.98%\s*\|/),
    },
  },
  {
    file: 'sample.epub',
    checks: {
      'book title': has('# The Small Book of Conversions'),
      'author line': has('_A. Writer_'),
      'chapter heading': has('Chapter One'),
      'emphasis preserved': has('_malformed_'),
      'second chapter list': has('- First point'),
    },
  },
  {
    file: 'sample.docx',
    // textutil writes bold paragraphs and literal "•" bullets rather than Word
    // styles — the same shape Pages and Google Docs exports have. This case
    // exists to prove the structure-repair pass recovers them.
    checks: {
      'bold paragraph promoted to heading': matches(/^## Field Notes/m),
      'second heading': matches(/^## Observations/m),
      'bold run': has('**bold**'),
      'italic run': has('_italic_'),
      'bullet glyphs became a list': has('- The first observation.'),
      'no stray bullet glyphs': lacks('•'),
    },
  },
  {
    file: 'sample.rtf',
    checks: {
      'body text': has('Field Notes'),
      'bold survived': has('**bold**'),
      'bullets recovered': has('- The first observation.'),
    },
  },
  {
    file: 'sample.odt',
    checks: {
      'body text': has('Field Notes'),
      'observation': has('The first observation.'),
    },
  },
  {
    file: 'sample.csv',
    checks: {
      'header': matches(/\|\s*Region\s*\|\s*Volume\s*\|\s*Change\s*\|/),
      'quoted comma cell': has('12,905'),
      'row count': matches(/\|\s*North\s*\|\s*7310\s*\|/),
    },
  },
  {
    file: 'sample.md',
    checks: {
      'source passed through verbatim': has('A paragraph with a [link](https://example.com) and `code`.'),
      'table untouched': has('| a | b |'),
      'front matter regenerated': matches(/^---\ntitle:/),
      'no double front matter': (md) => md.split('---').length <= 3 || 'front matter duplicated',
    },
  },
  {
    file: 'sample.html',
    options: { outputs: ['md', 'html', 'txt'] },
    checks: {
      'title heading': has('# Article Title'),
      'subheading': has('## A subheading'),
      'boilerplate removed': lacks('Copyright notice'),
      'nav removed': lacks('](/about)'),
      'table converted': matches(/\|\s*alpha\s*\|\s*1\s*\|/),
      'standalone html output': (md, r) => {
        const html = r.outputs.find((o) => o.format === 'html').content;
        return (
          (html.startsWith('<!doctype html>') && html.includes('<title>Article Title</title>')) ||
          'html output is not a standalone document'
        );
      },
      'text output': (md, r) => {
        const txt = r.outputs.find((o) => o.format === 'txt').content;
        return (!/[<>]/.test(txt) && txt.includes('Article Title')) || 'text output still contains markup';
      },
    },
  },
  {
    file: 'sample.json',
    checks: {
      'records became a table': matches(/\|\s*id\s*\|\s*name\s*\|\s*volume\s*\|/),
      'row present': matches(/\|\s*2\s*\|\s*West\s*\|\s*12905\s*\|/),
    },
  },
  {
    file: 'sample.srt',
    checks: {
      'timestamp anchor': has('**00:00:01**'),
      'cue lines merged': has('Today we are talking about file conversion.'),
      'later paragraph split': has('**00:01:02**'),
    },
  },
  {
    file: 'sample.ipynb',
    checks: {
      'markdown cell verbatim': has('# Notebook'),
      'code fence with language': has('```python'),
      'stream output': has('hello'),
    },
  },
];

/**
 * Formats whose fixtures are small enough to build inline. Each `make()`
 * returns bytes (or a string, encoded as UTF-8).
 */
const SYNTHETIC_CASES = [
  {
    name: 'message.eml',
    make: () =>
      [
        'From: Dana Ruiz <dana@example.com>',
        'To: ops@example.com',
        'Subject: =?utf-8?B?UXVhcnRlcmx5IHJlc3VsdHM=?=',
        'Date: Tue, 2 Apr 2026 09:14:00 +0000',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="BOUND"',
        '',
        '--BOUND',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Plain fallback that should lose to the HTML part.',
        '--BOUND',
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        '<h1>Quarterly results</h1><p>Revenue rose 12=25 percent.</p><ul><li>East</li><li>West</li></ul>',
        '--BOUND--',
        '',
      ].join('\n'),
    checks: {
      'subject decoded from RFC 2047': has('Quarterly results'),
      'header table': has('dana@example.com'),
      'html part preferred': has('- East'),
      'quoted-printable decoded': has('12% percent'),
      'plain part not used': lacks('Plain fallback'),
    },
  },
  {
    name: 'page.mhtml',
    make: () =>
      [
        'From: <Saved by Blink>',
        'Snapshot-Content-Location: https://example.com/report',
        'Subject: Saved page',
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; boundary="B"; type="text/html"',
        '',
        '--B',
        'Content-Type: text/html',
        'Content-Transfer-Encoding: quoted-printable',
        'Content-Location: https://example.com/report',
        '',
        '<html><head><title>Saved page</title></head><body><article><h1>Saved page</h1>' +
          '<p>This paragraph is long enough to be treated as the primary content of the saved ' +
          'document rather than discarded as navigation furniture by the extractor.</p>' +
          '<p><a href=3D"/next">next</a></p></article></body></html>',
        '--B--',
        '',
      ].join('\n'),
    checks: {
      'heading': has('# Saved page'),
      'quoted-printable "=3D" decoded': has('](https://example.com/next)'),
      'body text': has('primary content of the saved document'),
    },
  },
  {
    name: 'config.yaml',
    make: () => 'service: billing\nreplicas: 3\nlimits:\n  cpu: "500m"\n  memory: 1Gi\nregions:\n  - east\n  - west\n',
    checks: {
      'scalars as a list': has('**service:** billing'),
      'nested map became a section': has('## limits'),
      'sequence became a list': has('- east'),
    },
  },
  {
    name: 'events.jsonl',
    make: () =>
      ['{"id":1,"event":"open"}', '{"id":2,"event":"click"}', 'not json', '{"id":3,"event":"close"}'].join('\n'),
    checks: {
      'records became a table': matches(/\|\s*id\s*\|\s*event\s*\|/),
      'valid rows kept': has('click'),
      'bad line reported': (md, r) => r.warnings.some((w) => /Line 3/.test(w)) || 'no warning for the bad line',
    },
  },
  {
    name: 'feed.xml',
    make: () => '<?xml version="1.0"?><rss><channel><title>News</title><item><title>One</title></item></channel></rss>',
    checks: {
      'kept verbatim in a fence': has('```xml'),
      'content preserved': has('<title>News</title>'),
    },
  },
  {
    name: 'notes.txt',
    make: () => 'First paragraph line one\nline two\n\nSecond paragraph with * asterisks * and _underscores_.\n',
    checks: {
      'paragraph split': matches(/line two\n\nSecond paragraph/),
      'markdown metacharacters escaped': has('\\_underscores\\_'),
    },
  },
  {
    name: 'script.py',
    make: () => 'def main():\n    return "# not a heading"\n',
    checks: {
      'fenced as python': has('```python'),
      'content untouched': has('return "# not a heading"'),
    },
  },
  {
    name: 'inline-image.html',
    options: { imageMode: 'extract' },
    make: () =>
      '<html><head><title>With image</title></head><body><article><h1>With image</h1>' +
      '<p>A paragraph long enough to survive article extraction, describing the small image ' +
      'that follows it in this document so the extractor keeps the whole section.</p>' +
      '<p><img alt="dot" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="></p>' +
      '</article></body></html>',
    checks: {
      'image rewritten to a relative path': matches(/!\[dot\]\(inline-image_assets\/image-001\.png\)/),
      'asset returned for the zip': (md, r) =>
        (r.assets.length === 1 && r.assets[0].bytes.byteLength > 0) || `assets: ${r.assets.length}`,
      'no data URI left in the markdown': lacks('data:image'),
    },
  },
  {
    // The confident-but-wrong cases: OCR scores these highly because "340.00"
    // is a perfectly good number. Only structure catches them.
    name: 'suspect-invoice.html',
    make: () =>
      '<html><head><title>Invoice</title></head><body><article>' +
      '<p>This invoice is long enough to survive article extraction, and it carries a ' +
      'services table whose figures are deliberately inconsistent so the validators have ' +
      'something to find.</p>' +
      '<table><tr><th>Item</th><th>Amount</th></tr>' +
      '<tr><td>Consultation</td><td>$40.00</td></tr>' +
      '<tr><td>Imaging</td><td>340.00</td></tr>' +
      '<tr><td>Total</td><td>$95.00</td></tr></table></article></body></html>',
    checks: {
      'flags the amount missing its "$"': has('"340.00" may be "$40.00"'),
      'names the likely cause': has('misread as "3"'),
      'flags the total that does not reconcile': matches(/line items sum to \$380\.00 but the total row says \$95\.00/),
      'marker is a comment, not visible prose': matches(/<!-- SUMCHECK: /),
      'records the flags in front matter': matches(/needs_review: true/),
      'counts them': matches(/review_flags: 2/),
      'surfaces them in JSON': (md, r) => {
        const doc = JSON.parse(
          r.outputs.find((o) => o.format === 'json')?.content ||
            JSON.stringify({ review: r.review })
        );
        return (doc.review?.length ?? r.review.length) >= 2 || 'JSON output carries no review array';
      },
      'leaves the correct amount alone': (md) =>
        !/\$40\.00.*SUMCHECK/.test(md.split('\n').find((l) => /Consultation/.test(l)) || '') ||
        'flagged a correct value',
    },
    options: { outputs: ['md', 'json'] },
  },
  {
    // A headline figure recovered by OCR has nothing checking it — except the
    // same number printed in the totals row. Disagreement means one of them is
    // wrong, and the prominent one is the one a reader will act on.
    name: 'headline-mismatch.html',
    make: () =>
      '<html><head><title>Estimate</title></head><body><article>' +
      '<p>This estimate is long enough to survive article extraction and carries a headline ' +
      'figure that disagrees with the total stated in its own services table below.</p>' +
      '<h1>$620.00</h1>' +
      '<table><tr><th>Item</th><th>Amount</th></tr>' +
      '<tr><td>Imaging</td><td>$400.00</td></tr>' +
      '<tr><td>Total</td><td>$600.00</td></tr></table></article></body></html>',
    checks: {
      'flags the headline that matches no stated total': has('headline figure $620.00 matches none'),
      'names the totals it was compared against': has('$600.00'),
      'the figure is flagged, never corrected': (md) =>
        /\$620\.00/.test(md) || 'the headline value was altered rather than flagged',
      'recorded in front matter': matches(/needs_review: true/),
    },
    options: { outputs: ['md'] },
  },
  {
    // The same shape, agreeing. A validator that fires here is worse than none.
    name: 'headline-agrees.html',
    make: () =>
      '<html><head><title>Estimate</title></head><body><article>' +
      '<p>This estimate is long enough to survive article extraction and its headline figure ' +
      'agrees exactly with the total stated in the services table below it.</p>' +
      '<h1>$600.00</h1>' +
      '<table><tr><th>Item</th><th>Amount</th></tr>' +
      '<tr><td>Imaging</td><td>$600.00</td></tr>' +
      '<tr><td>Total</td><td>$600.00</td></tr></table></article></body></html>',
    checks: {
      'no headline flag when the figures agree': lacks('matches none'),
      'no review flag at all': lacks('needs_review'),
    },
    options: { outputs: ['md'] },
  },
  {
    name: 'bundle.zip',
    make: async () => {
      const zip = new JSZip();
      zip.file('docs/notes.md', '# Bundled notes\n\nInside a zip.\n');
      zip.file('data/rows.csv', 'a,b\n1,2\n');
      zip.file('skip-me.bin', new Uint8Array([1, 2, 3]));
      return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }));
    },
    expandsTo: ['notes.md', 'rows.csv'],
  },
  {
    name: 'sheet.ods',
    make: () =>
      odf('application/vnd.oasis.opendocument.spreadsheet', `
<office:body><office:spreadsheet>
<table:table table:name="Budget">
<table:table-row><table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Cost</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Server</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="1200"><text:p>1,200</text:p></table:table-cell></table:table-row>
</table:table>
</office:spreadsheet></office:body>`),
    checks: {
      'sheet name as heading': has('## Budget'),
      'table rendered': matches(/\|\s*Server\s*\|\s*1,200\s*\|/),
    },
  },
  {
    name: 'deck.odp',
    make: () =>
      odf('application/vnd.oasis.opendocument.presentation', `
<office:body><office:presentation>
<draw:page draw:name="Opening">
<draw:frame><draw:text-box><text:p>Welcome to the review</text:p></draw:text-box></draw:frame>
</draw:page>
<draw:page draw:name="Numbers">
<draw:frame><draw:text-box><text:p>Revenue is up</text:p></draw:text-box></draw:frame>
</draw:page>
</office:presentation></office:body>`),
    checks: {
      'slide names as headings': has('## Opening'),
      'second slide': has('## Numbers'),
      'slide text': has('Welcome to the review'),
    },
  },
];

/** Build a minimal OpenDocument package around a content.xml body. */
async function odf(mimetype, body) {
  const zip = new JSZip();
  zip.file('mimetype', mimetype);
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
${body}
</office:document-content>`
  );
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }));
}

async function runSynthetic({ name, make, options = {}, checks, expandsTo }) {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>${name}</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name, pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const made = await make();
    const bytes = typeof made === 'string' ? new TextEncoder().encode(made) : made;
    const started = performance.now();
    const result = await convertFile({ bytes, name }, options, {});
    record.ms = Math.round(performance.now() - started);

    if (expandsTo) {
      const got = (result.expand || []).map((f) => f.name).sort();
      const want = [...expandsTo].sort();
      record.md = JSON.stringify(got, null, 1);
      renderChecks(
        box,
        record,
        {
          'archive expanded to its convertible members': () =>
            JSON.stringify(got) === JSON.stringify(want) || `got ${JSON.stringify(got)}`,
        },
        record.md,
        result
      );
      return;
    }

    record.warnings = result.warnings;
    const md = result.outputs.find((o) => o.format === 'md').content;
    record.md = md;
    renderChecks(box, record, checks, md, result);
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error(name, err);
  }
}

/**
 * A fresh OCR worker must always be configured.
 *
 * The parameter cache lives at module scope, keyed only by dpi. If a worker
 * fails to create — a missing language, a transient wasm failure — the promise
 * is cleared but the cache is not, so the *next* worker can be told "already
 * configured at this dpi" and never receive `user_defined_dpi` or
 * `preserve_interword_spaces` at all. Silent, and it would have invalidated the
 * configuration diff this instrumentation exists to run.
 */
async function runWorkerParameterCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>OCR worker is reconfigured after a failed worker</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'ocr-worker-parameters', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const { recognize, terminateOcr, __simulateLostWorker } = await import('../src/core/ocr.js');
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = '28px Helvetica, Arial, sans-serif';
    ctx.fillText('Tax ID: 04-3642199', 20, 70);

    await terminateOcr();
    const started = performance.now();

    const first = await recognize(canvas, { lang: 'eng', dpi: 192 });

    // The state a failed worker creation leaves behind: promise dropped, and
    // historically the parameter cache left intact.
    __simulateLostWorker();

    // Same dpi as the first call — the cache must not suppress configuring the
    // worker that replaced the lost one.
    const third = await recognize(canvas, { lang: 'eng', dpi: 192 });
    record.ms = Math.round(performance.now() - started);
    record.md = JSON.stringify(
      { first: first.parametersApplied, third: third.parametersApplied },
      null,
      1
    );
    await terminateOcr();

    renderChecks(
      box,
      record,
      {
        'the first worker is configured': () =>
          first.parametersApplied === true || 'parameters were not applied to the first worker',
        'the replacement worker is configured too': () =>
          third.parametersApplied === true ||
          'the stale dpi cache suppressed setParameters on a fresh worker',
        'it still reads the page': () => /3642199/.test(third.lines.map((l) => l.text).join(' ')) ||
          'the replacement worker produced no usable text',
      },
      record.md,
      { outputs: [], warnings: [], meta: {} }
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('worker parameters', err);
  }
}

/**
 * A word whose confidence cannot be read must say so, not report zero.
 *
 * The previous `w.confidence ?? 0` turned an unexpected engine output shape
 * into a page full of words scoring 0 — every one of them flagged, with no
 * error anywhere. That is the exact failure mode this cycle is investigating,
 * so the guard is asserted rather than assumed.
 */
async function runConfidenceShapeCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>unreadable word confidence is reported, not zeroed</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'ocr-confidence-shape', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const { readWordConfidence, ocrDiagnostics, resetOcrDiagnostics } = await import(
      '../src/core/ocr.js'
    );
    resetOcrDiagnostics();

    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    const good = readWordConfidence({ text: 'Tax', confidence: 96 });
    const missing = readWordConfidence({ text: 'Tax' });
    const notANumber = readWordConfidence({ text: 'Tax', confidence: 'high' });
    const nan = readWordConfidence({ text: 'Tax', confidence: NaN });

    console.warn = realWarn;
    const diagnostics = ocrDiagnostics();
    resetOcrDiagnostics();
    record.ms = 0;
    record.md = JSON.stringify({ good, missing, notANumber, nan, diagnostics, warnings }, null, 1);

    renderChecks(
      box,
      record,
      {
        'a real score passes through': () => good === 96 || `got ${good}`,
        'a missing score is null, not 0': () =>
          missing === null || `got ${JSON.stringify(missing)} — 0 would flag a correct word`,
        'a non-numeric score is null': () => notANumber === null || `got ${notANumber}`,
        'NaN is null': () => nan === null || `got ${nan}`,
        'the run counts them': () =>
          diagnostics.wordsWithoutConfidence === 3 || `counted ${diagnostics.wordsWithoutConfidence}`,
        'and warns once, loudly': () =>
          (warnings.length === 1 && /confidence/i.test(warnings[0])) ||
          `warnings: ${JSON.stringify(warnings)}`,
      },
      record.md,
      { outputs: [], warnings: [], meta: {} }
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('confidence shape', err);
  }
}

/**
 * The exact heading strings the real corpus produced, asserted against the
 * rejection rules.
 *
 * The rendered fixture cannot reproduce the promotion reliably — it depends on
 * OCR mis-measuring a fragment's glyph height — so the observed strings are the
 * reproduction, and they are pinned here verbatim.
 */
async function runHeadingRejectionCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>corpus heading fragments are rejected</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'ocr-heading-rejection', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const { rejectedOcrHeading } = await import('../src/core/adapters/pdf.js');

    // Observed as `####` headings across GFE (14), (15), (25), (28) and (47).
    const fragments = [
      'MATERIAL(S)',
      '(EG, FOR FOLLICLES)',
      '(Forearm)/Wrist/Heel (Appendicular)',
      'HEEL)',
      '08-14-2026 CT Angiography Coronary (Coronary CTA/CCTA)',
    ];
    // Real headings from the same corpus, plus ordinary ones that must survive.
    const keep = [
      'Good Faith Estimate for Health Care Items and Services',
      'Total Estimated Costs:',
      '$7,311.39',
      'DETAILS OF SERVICES AND CHARGES',
      'Summary of Findings',
      'Regional Results',
    ];

    const rejected = fragments.map((t) => [t, rejectedOcrHeading(t)]);
    const kept = keep.map((t) => [t, rejectedOcrHeading(t)]);
    record.md = JSON.stringify({ rejected, kept }, null, 1);

    renderChecks(
      box,
      record,
      {
        'every observed fragment is rejected': () => {
          const missed = rejected.filter(([, why]) => !why).map(([t]) => t);
          return missed.length === 0 || `not rejected: ${JSON.stringify(missed)}`;
        },
        'each rejection names the rule that caught it': () =>
          rejected.every(([, why]) => typeof why === 'string' && why.length > 2) ||
          'a rejection returned no rule name',
        'legitimate headings are untouched': () => {
          const lost = kept.filter(([, why]) => why).map(([t, why]) => `${t} (${why})`);
          return lost.length === 0 || `wrongly rejected: ${JSON.stringify(lost)}`;
        },
        'an all-caps heading without brackets survives': () =>
          !rejectedOcrHeading('DETAILS OF SERVICES AND CHARGES') ||
          'the uppercase rule is too broad — it needs a bracket to fire',
      },
      record.md,
      { outputs: [], warnings: [], meta: {} }
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('heading rejection', err);
  }
}

/**
 * The rescue crop that re-read a money column it had already read correctly.
 *
 * Coordinates are the ones measured in GFE (49): the crop returned "$1,932.00"
 * a second time as "$1.9" + "32.00" at the same pixels, and both were appended
 * to the row. Text comparison cannot catch that — the duplicate does not equal
 * what it duplicates — so the geometry is the fixture.
 */
async function runRescueDedupCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>a rescue crop does not re-read what was already read</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'ocr-rescue-dedup', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const { dropAlreadyRead } = await import('../src/core/adapters/pdf.js');
    const word = (text, x, x2) => ({ text, x, x2, top: 796, bottom: 817 });
    const line = (words) => ({
      text: words.map((w) => w.text).join(' '),
      words,
      x: Math.min(...words.map((w) => w.x)),
      x2: Math.max(...words.map((w) => w.x2)),
      top: 796,
      bottom: 817,
    });

    const readWords = [
      word('1', 1105, 1112),
      word('$1,932.00', 1193, 1304),
      word('$1,932.00', 1385, 1496),
    ];
    // Exactly what the crop returned, plus one genuinely new word off to the
    // side — a rescue that recovers something must still survive.
    const recovered = [
      line([word('1', 1105, 1112), word('$1.9', 1193, 1248), word('32.00', 1248, 1305)]),
      line([word('$1.9', 1385, 1440)]),
      line([word('$597.71', 1600, 1700)]),
    ];

    const kept = dropAlreadyRead(recovered, readWords);
    const keptText = kept.map((l) => l.text);
    record.md = JSON.stringify({ keptText, kept }, null, 1);

    renderChecks(
      box,
      record,
      {
        'the re-read money column is dropped': () =>
          !keptText.some((t) => /\$1\.9|32\.00/.test(t)) ||
          `a duplicate survived: ${JSON.stringify(keptText)}`,
        'the duplicated quantity is dropped': () =>
          !keptText.includes('1') || 'the re-read "1" survived',
        'genuinely new text is kept': () =>
          keptText.includes('$597.71') || 'the rescue dropped a real recovery',
        'a surviving line reports only the geometry it kept': () => {
          const survivor = kept.find((l) => l.text === '$597.71');
          return (survivor && survivor.x === 1600 && survivor.x2 === 1700) ||
            'the kept line carries a box it no longer covers';
        },
        'nothing is dropped when no ink was read before': () =>
          dropAlreadyRead(recovered, []).length === recovered.length ||
          'an empty read set still dropped lines',
      },
      record.md,
      { outputs: [], warnings: [], meta: {} }
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('rescue dedup', err);
  }
}

/**
 * The prose lexicon validator: catch a confident non-word, stay silent on
 * correct clinical text.
 *
 * The strings are the real ones. "inchided" is what the `fast` language pack
 * reads "included" as on all 50 corpus documents; "Cervical" is a word an
 * earlier pack got wrong and a small dictionary would flag; the all-caps
 * descriptor and the coded table row are the two shapes that produced false
 * alarms before the exclusions existed.
 */
async function runProseLexiconCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>a confident non-word is flagged, correct clinical prose is not</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'prose-lexicon', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const { validateDocument } = await import('../src/core/validate.js');
    const host = document.createElement('div');
    host.innerHTML = [
      '<p>Your provider may recommend additional services in the course of care: those',
      'services are not inchided in this estimate and would be scheduled separately.</p>',
      '<p>Cervical spine imaging was performed at the parotid and appendicular sites.</p>',
      '<h3>DUAL-ENERGY X-RAY ABSORPTIOMETRY</h3>',
      '<p>Prepared at 3310 Richmond Ave, Trenton. Tax ID: 04-3642199.</p>',
      '<table><tr><td>77081 - DUAL-ENERGY X-RAY ABSORPTIOMETRY (DXA)</td><td>$51.00</td></tr></table>',
    ].join(' ');

    const flags = await validateDocument(host, { markers: true, ocr: true });
    const messages = flags.map((f) => f.message);
    const markers = [...host.querySelectorAll('[data-smc-review]')].map((m) => m.getAttribute('data-smc-review'));
    record.md = JSON.stringify({ messages, markers }, null, 1);

    // The same document with OCR off must produce nothing from this check.
    const quiet = document.createElement('div');
    quiet.innerHTML = host.textContent ? '<p>those services are not inchided here.</p>' : '';
    const noOcrFlags = await validateDocument(quiet, { markers: false, ocr: false });

    renderChecks(
      box,
      record,
      {
        'the non-word is flagged': () =>
          messages.some((m) => m.includes('"inchided"')) ||
          `nothing flagged inchided: ${JSON.stringify(messages)}`,
        'the flag names the right word': () =>
          messages.some((m) => m.includes('"inchided"') && m.includes('"included"')) ||
          `wrong or missing suggestion: ${JSON.stringify(messages)}`,
        'exactly one prose flag is raised': () => {
          const lex = messages.filter((m) => m.includes('is not a recognised word'));
          return lex.length === 1 || `expected 1, got ${lex.length}: ${JSON.stringify(lex)}`;
        },
        'Cervical is not flagged': () =>
          !messages.some((m) => /Cervical/i.test(m)) || 'a correct clinical word was flagged',
        'parotid and appendicular are not flagged': () =>
          !messages.some((m) => /parotid|appendicular/i.test(m)) ||
          'a correct clinical word was flagged',
        'the all-caps descriptor is not flagged': () =>
          !messages.some((m) => /ABSORPTIOMETRY|ENERGY/i.test(m)) ||
          'an all-caps descriptor was flagged',
        'proper nouns are not flagged': () =>
          !messages.some((m) => /Richmond|Trenton/i.test(m)) || 'a proper noun was flagged',
        'the coded table row is not flagged': () =>
          !messages.some((m) => /77081|DXA/i.test(m)) || 'a table descriptor was flagged',
        'a marker is attached at the flagged paragraph': () => {
          const marks = [...host.querySelectorAll('[data-smc-review]')];
          if (marks.length !== 1) return `expected 1 marker, found ${marks.length}`;
          return (
            marks[0].getAttribute('data-smc-review').includes('inchided') ||
            'the marker does not name the token it is about'
          );
        },
        'nothing is rewritten': () =>
          host.textContent.includes('inchided') ||
          'the validator changed the text instead of flagging it',
        'the check does not run when the document was not OCR\'d': () =>
          noOcrFlags.length === 0 || `ran anyway: ${JSON.stringify(noOcrFlags)}`,
      },
      record.md,
      { outputs: [], warnings: [], meta: {} }
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('prose lexicon', err);
  }
}

/**
 * The password path, end to end through the conversion core.
 *
 * `locked.pdf` is a real RC4-encrypted PDF built by `make-fixtures.mjs`; the
 * password is "secret". The behaviour that matters in a batch is not that the
 * right password works — it is that the wrong answer and the refusal both end
 * the file cleanly and let the next one run.
 */
async function runPasswordCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>a password-protected PDF prompts, retries and can be skipped</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'locked.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const locked = new Uint8Array(await (await fetch('fixtures/locked.pdf')).arrayBuffer());
    const plain = new Uint8Array(await (await fetch('fixtures/sample.pdf')).arrayBuffer());
    const convert = (bytes, name, requestPassword) =>
      convertFile({ bytes: bytes.slice(), name }, { outputs: ['md'] }, { requestPassword });

    // 1. correct password
    const prompts = [];
    const ok = await convert(locked, 'locked.pdf', (retry) => {
      prompts.push(retry);
      return 'secret';
    });
    const okMd = ok.outputs[0].content;

    // 2. wrong password, then the right one — pdf.js re-asks with retry = true
    const retries = [];
    const afterRetry = await convert(locked, 'locked.pdf', (retry) => {
      retries.push(retry);
      return retries.length === 1 ? 'wrong-password' : 'secret';
    });

    // 3. skipped, then the next file in the batch still converts
    let skipError = null;
    await convert(locked, 'locked.pdf', () => null).catch((err) => {
      skipError = err.message;
    });
    const next = await convert(plain, 'sample.pdf', () => null);
    const nextMd = next.outputs[0].content;

    record.md = JSON.stringify(
      { prompts, retries, skipError, unlockedText: okMd.slice(0, 120) },
      null,
      1
    );

    renderChecks(
      box,
      record,
      {
        'the converter asks for a password': () =>
          prompts.length === 1 || `asked ${prompts.length} time(s)`,
        'the first ask is not flagged as a retry': () =>
          prompts[0] === false || 'the first prompt claimed to be a retry',
        'the correct password unlocks the document': () =>
          /Locked document/.test(okMd) || `did not decrypt: ${JSON.stringify(okMd.slice(0, 80))}`,
        'a wrong password re-prompts, flagged as a retry': () =>
          (retries.length === 2 && retries[0] === false && retries[1] === true) ||
          `retry sequence was ${JSON.stringify(retries)}`,
        'the retry succeeds': () =>
          /Locked document/.test(afterRetry.outputs[0].content) ||
          'the second password did not unlock it',
        'skipping fails the file rather than hanging': () =>
          Boolean(skipError) || 'skipping resolved instead of failing',
        'the skip reason says it was skipped': () =>
          /skipped/i.test(skipError || '') ||
          `unhelpful reason: ${JSON.stringify(skipError)}`,
        'the skip reason is not a worker error': () =>
          !/worker|destroy/i.test(skipError || '') ||
          `leaked an internal error: ${JSON.stringify(skipError)}`,
        'the next file in the batch still converts': () =>
          nextMd.length > 200 || 'a skipped file poisoned the rest of the batch',
      },
      record.md,
      { outputs: [], warnings: [], meta: {} }
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('password case', err);
  }
}

/**
 * The i18n fallback.
 *
 * Installed, `chrome.i18n` answers. Under the dev server there is no `chrome`
 * at all, which is the runtime this whole suite uses — so if the fallback ever
 * breaks, every page in development renders blank labels while the extension
 * looks fine. That is a failure worth a test of its own.
 */
async function runI18nFallbackCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>UI strings resolve without chrome.i18n</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'i18n-fallback', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const { initI18n, t, localizeDocument } = await import('../src/ui/i18n.js');
    record.warnings.push(typeof chrome === 'undefined' ? 'no chrome object — fallback path' : 'chrome present');
    await initI18n();

    const host = document.createElement('div');
    host.innerHTML =
      '<p data-i18n="popupOpen"></p>' +
      '<p data-i18n="uiSettingsNoteEmphasis"></p>' +
      '<p data-i18n="sumcheck_no_such_key"></p>' +
      '<button data-i18n-attr="title:popupSettings"></button>';
    localizeDocument(host);

    const texts = [...host.querySelectorAll('p')].map((n) => n.textContent);
    record.md = JSON.stringify(
      { texts, title: host.querySelector('button').getAttribute('title'), substituted: t('supportedFormats', '.pdf .docx') },
      null,
      1
    );

    renderChecks(
      box,
      record,
      {
        'a known message resolves': () =>
          texts[0] === 'Convert files…' || `got ${JSON.stringify(texts[0])}`,
        'messages are not blank': () =>
          texts[1] === 'any' || `got ${JSON.stringify(texts[1])}`,
        'an unknown key shows the key, never an empty element': () =>
          texts[2] === 'sumcheck_no_such_key' || `got ${JSON.stringify(texts[2])}`,
        'attributes are localized': () =>
          host.querySelector('button').getAttribute('title') === 'Settings' ||
          'data-i18n-attr did not apply',
        'placeholders are substituted': () =>
          t('supportedFormats', '.pdf .docx') === 'Supports .pdf .docx' ||
          `got ${JSON.stringify(t('supportedFormats', '.pdf .docx'))}`,
        'a missing substitution leaves the placeholder visible': () =>
          t('supportedFormats') === 'Supports $1' || `got ${JSON.stringify(t('supportedFormats'))}`,
      },
      record.md,
      { outputs: [], warnings: [], meta: {} }
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('i18n fallback', err);
  }
}

/**
 * Nested key-value structure inside a table cell (issues #1 and #4).
 *
 * `test/fixtures/field-details.pdf` reproduces the shape of page 600 of the Net
 * Zero Cloud guide with invented values: a Field/Details table where each
 * Details cell holds its own definition list — a label on one line, its value
 * indented beneath.
 *
 * Two things must hold, and only one of them held before this case existed:
 *
 *  - **Row faithfulness.** Every value stays in the row it came from. We were
 *    already 17/17 here; Docling scored 8/17 on the same page with confirmed
 *    cross-row drift. This is the property a structure change must not break.
 *  - **Structure.** The pairs survive as pairs. We flattened them to run-on
 *    text, which is what issue #1 is.
 */
async function runFieldDetailsCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>nested key-value pairs survive inside a table cell</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'field-details.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/field-details.pdf')).arrayBuffer());
    const started = performance.now();
    const result = await convertFile({ bytes, name: 'field-details.pdf' }, { outputs: ['md', 'json'] }, {});
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs.find((o) => o.format === 'md').content;
    record.md = md;

    // The reference table, keyed by field name -> its Details cell.
    const cells = {};
    for (const line of md.split('\n')) {
      if (!line.startsWith('|')) continue;
      const parts = line.split('|').map((c) => c.trim());
      if (parts.length < 4) continue;
      cells[parts[1]] = parts[2];
    }

    // Expected tokens per row, from issue #4.
    const EXPECTED = {
      Scope3EmssnSrcId: ['reference', 'Create, Filter, Group, Sort, Update', 'scope 3 emission source', 'Scope3EmssnSrc', 'Lookup'],
      Scope3GhgCategory: ['picklist', 'Restricted picklist', 'scope 3 GHG category', 'BusinessTravel', 'EmployeeCommuting'],
      StartDate: ['date', 'Create, Filter, Group, Nillable, Sort, Update', 'date from when the values'],
      SuplScope3Emissions: ['double', 'Create, Filter, Nillable, Sort, Update', 'supplemental scope 3 emissions'],
      SupplierId: ['reference'],
    };
    let present = 0;
    let expected = 0;
    const missing = [];
    for (const [field, tokens] of Object.entries(EXPECTED)) {
      for (const token of tokens) {
        expected++;
        if ((cells[field] || '').includes(token)) present++;
        else missing.push(`${field}: ${token}`);
      }
    }

    // Content belonging to another row, appearing in this one.
    const foreign = [];
    for (const [field, cell] of Object.entries(cells)) {
      for (const [other, tokens] of Object.entries(EXPECTED)) {
        if (other === field) continue;
        for (const token of tokens) {
          if (token.length > 18 && cell.includes(token) && !(EXPECTED[field] || []).includes(token)) {
            foreign.push(`${field} <- ${other}: ${token}`);
          }
        }
      }
    }

    /** A pair is preserved when its label and value are bound, not just adjacent. */
    const pairsIn = (cell) => (cell.match(/(?:^|<br>)\s*[A-Z][A-Za-z ]*:\s*\S/g) || []).length;

    record.md = JSON.stringify({ rowFaithful: `${present}/${expected}`, foreign, cells }, null, 1);

    renderChecks(
      box,
      record,
      {
        'the reference page emits a table': () =>
          Object.keys(cells).length >= 6 || `found ${Object.keys(cells).length} row(s)`,
        'every expected value is in its own row': () =>
          present === expected || `${present}/${expected}; missing ${JSON.stringify(missing.slice(0, 3))}`,
        'no content drifts between rows': () =>
          foreign.length === 0 || JSON.stringify(foreign.slice(0, 3)),
        'pairs survive as pairs, not run-on text': () => {
          const n = pairsIn(cells.Scope3EmssnSrcId || '');
          return n >= 6 || `only ${n} label:value pair(s) in the Scope3EmssnSrcId cell`;
        },
        'each label binds to its own value': () =>
          /Type:\s*reference/.test(cells.Scope3EmssnSrcId || '') &&
            /Relationship Type:\s*Lookup/.test(cells.Scope3EmssnSrcId || '') ||
          'labels are not bound to their values',
        'a multi-value pair keeps all its values': () =>
          /BusinessTravel/.test(cells.Scope3GhgCategory || '') &&
            /EmployeeCommuting/.test(cells.Scope3GhgCategory || '') ||
          'the bullet list under "Possible values are" lost a value',
        'nothing is promoted out of the cell': () =>
          !/^#{1,6}\s+(Type|Properties|Description|Relationship (Name|Type)|Refers To)\s*$/m.test(md) ||
          'a cell label was promoted to a heading',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('field-details', err);
  }
}

/**
 * Page chrome: varying running heads and printed folios (issue #2).
 *
 * The same fixture as the T1 case. Its head repeats on the left and names the
 * page's object on the right — the pairing that defeats a whole-line
 * repetition test — and its folios increment, so they never repeat at all.
 * Measured on the real 1,349-page guide, the pass caught 0.3% of heads and
 * 0.0% of folios before this.
 *
 * The last two checks are the guardrail. Repetition is the licence to strip; a
 * line seen once is content, and stripping that is a worse failure than leaving
 * a page number in.
 */
async function runPageChromeCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>running heads and folios are stripped, content is not</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'page-chrome', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/field-details.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'field-details.pdf' }, { outputs: ['md'] }, {});
    const md = result.outputs[0].content;
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    const lines = body.split('\n').map((l) => l.trim());

    const heads = lines.filter((l) => /^Standard Objects Reference\b/.test(l));
    const folios = lines.filter((l) => /^(599|600|601)$/.test(l));
    record.md = JSON.stringify({ heads, folios, warnings: result.warnings }, null, 1);

    renderChecks(
      box,
      record,
      {
        'the varying running head is stripped': () =>
          heads.length === 0 || `${heads.length} survived: ${JSON.stringify(heads)}`,
        'printed folios are stripped, across a decade boundary': () =>
          folios.length === 0 || `${folios.length} survived: ${JSON.stringify(folios)}`,
        'field names survive': () =>
          ['Scope3EmssnSrcId', 'RentalCarCompanyName', 'SupplierId'].every((f) => body.includes(f)) ||
          'stripping removed table content',
        'cell values survive': () =>
          body.includes('The name of the rental car company.') || 'stripping removed a cell value',
        'a chrome line seen on one page only is kept': () =>
          body.includes('Draft for internal review only') ||
          'a line appearing once was stripped — repetition is the licence, and it had none',
        'the document title survives': () =>
          /^#\s+Object Reference/m.test(body) || 'the title was stripped as chrome',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('page-chrome', err);
  }
}

/**
 * A wrapped display-size title is one heading, not two (issue #6).
 *
 * The document's title is the first thing a reader or a chunker sees, so a
 * split there costs more than its size suggests. The merge is licensed by
 * three things together — same size, same heading level, and a gap that is
 * ordinary leading for that size — and the fixture carries the cases where
 * only some of those hold, because those must not merge.
 */
async function runSplitTitleCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>a wrapped display title is one heading</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'split-title', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/split-title.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'split-title.pdf' }, { outputs: ['md'] }, {});
    const md = result.outputs[0].content;
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    record.md = body;

    const headings = [...body.matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => m[1].trim());
    const has = (t) => headings.includes(t);

    renderChecks(
      box,
      record,
      {
        'the wrapped title is one heading': () =>
          has('Net Zero Cloud Developer Guide') || `headings were ${JSON.stringify(headings)}`,
        'its second line is not a heading of its own': () =>
          !has('Guide') || 'the tail of the title is still a sibling heading',
        'its first line is not left behind': () =>
          !has('Net Zero Cloud Developer') || 'the head of the title is still a heading of its own',
        'headings separated by body text stay separate': () =>
          (has('Overview') && has('Details')) || `lost one of Overview/Details: ${JSON.stringify(headings)}`,
        'headings separated by a wide gap stay separate': () =>
          (has('Appendix') && has('Glossary')) || `merged across a section break: ${JSON.stringify(headings)}`,
        'no heading swallowed body text': () =>
          headings.every((h) => h.length <= 60) || `over-long heading: ${JSON.stringify(headings)}`,
        'the body paragraph survives intact': () =>
          body.includes('Salesforce Net Zero Cloud helps organizations track and report their carbon footprint') ||
          'the paragraph under the title was damaged',
        'the metadata title is still emitted once': () =>
          (body.match(/^#\s+Developer documentation$/gm) || []).length === 1 ||
          'the cover title changed',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('split-title', err);
  }
}

/**
 * "Copy diagnostic info" leaks nothing (issue #7).
 *
 * The failure mode here is inclusion, not omission, so most of this case
 * asserts absences. `diagnostics.pdf` is built to make an absence provable: it
 * carries a word that cannot occur by chance (`Zquarnix`), a misspelling
 * (`recieved`), and a printed total that disagrees with its own line items — so
 * the arithmetic check fires and its message quotes `$1550.00`, `$1560.00` and
 * `$10.00`. If a flag's message ever reached the payload, those digits would
 * arrive with it.
 *
 * The last assertion is the general one: no twelve-character run of the
 * converted body appears anywhere in the block. Twelve is long enough that a
 * shared word like "settings" cannot collide, and short enough that any real
 * leak — a file name, a quoted phrase, a marker — is caught many times over.
 */
async function runDiagnosticsCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>diagnostic info carries counts and settings, never content</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'diagnostics', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/diagnostics.pdf')).arrayBuffer());
    const options = { outputs: ['md'] };
    const result = await convertFile({ bytes, name: 'diagnostics.pdf' }, options, {});
    const md = result.outputs[0].content;
    record.warnings = result.warnings;

    const payload = buildDiagnostics({
      meta: result.meta,
      review: result.review,
      options: { ...DEFAULT_OPTIONS, ...options },
      kind: result.detected?.kind,
    });
    record.md = payload;

    // The haystack is the document body. Front matter keys are the converter's
    // own vocabulary, not the document's, and `source_format` legitimately
    // appears in both.
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    const flat = body.replace(/\s+/g, ' ');
    const windows = [];
    for (let i = 0; i + 12 <= flat.length; i++) windows.push(flat.slice(i, i + 12));
    const leaked = windows.filter((w) => payload.includes(w));

    renderChecks(
      box,
      record,
      {
        'names the product and version': () =>
          /^Sumcheck \S+/.test(payload) || `first line was ${JSON.stringify(payload.split('\n')[0])}`,
        'names the browser': () => /Chrome/.test(payload) || 'no browser recorded',
        'reports the source format': () => payload.includes('source_format: pdf') || 'format missing',
        'reports the page count': () => payload.includes('pages: 1') || 'page count missing',
        'reports the OCR state': () => /ocr: (yes|no)/.test(payload) || 'OCR state missing',
        'reports the flag count': () => payload.includes('review_flags: 1') || 'flag count missing',
        'reports flag counts by type': () =>
          payload.includes('total-mismatch=1') || `by-type missing from ${JSON.stringify(payload)}`,
        'reports the output set and how many settings are default': () =>
          (payload.includes('settings: outputs=md') && /\(\d+ other settings at defaults\)/.test(payload)) ||
          `settings line was ${JSON.stringify(payload.split('\n').pop())}`,
        /**
         * A bug report's signal is what is unusual about the run. Twenty
         * default values printed in full bury the one that matters, so only
         * deviations are named — and a deviation must actually be named.
         */
        'names a setting that differs from its default': () => {
          const changed = buildDiagnostics({
            meta: result.meta,
            review: result.review,
            options: { ...DEFAULT_OPTIONS, ocrMode: 'always', validate: false },
            kind: 'pdf',
          });
          if (!changed.includes('ocrMode=always')) return 'a changed setting was not reported';
          if (!changed.includes('validate=off')) return 'a disabled check was not reported';
          if (changed.includes('pdfTables=')) return 'a default setting was reported anyway';
          return true;
        },

        'no file name': () => !payload.includes('diagnostics.pdf') || 'the file name leaked',
        'no document title': () => !payload.includes('Zquarnix') || 'the title leaked',
        'no word from the body': () => !payload.includes('recieved') || 'body text leaked',
        'no amount from the document': () =>
          !/1[,.]?5[0-9]0/.test(payload) || 'a currency amount leaked',
        'no flag message': () =>
          !payload.includes('line items sum to') || 'a validator message leaked',
        'no run of converted text appears in the payload': () =>
          leaked.length === 0 || `${leaked.length} run(s) leaked, e.g. ${JSON.stringify(leaked[0])}`,

        /**
         * A conversion that threw is when this is needed most, and it is also
         * when the one string that could quote the document — the error
         * message — is closest to hand. The failed payload says the conversion
         * failed and nothing about why.
         */
        'a failed conversion still produces a payload': () => {
          const failedPayload = buildDiagnostics({
            options: { ...DEFAULT_OPTIONS, ...options },
            kind: 'pdf',
            failed: true,
          });
          if (!/^Sumcheck \S+/.test(failedPayload)) return 'no version on the failed payload';
          if (!failedPayload.includes('status: conversion failed')) return 'failure not recorded';
          if (!failedPayload.includes('settings: outputs=md')) return 'settings missing';
          const leakedOnFail = windows.filter((w) => failedPayload.includes(w));
          return !leakedOnFail.length || `failed payload leaked ${JSON.stringify(leakedOnFail[0])}`;
        },
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('diagnostics', err);
  }
}

/**
 * A PDF's own outline outranks what glyph sizes suggest (Q1).
 *
 * Born-digital PDFs usually carry their heading tree in the file. Re-deriving
 * it from type size is guesswork against data the document already states, and
 * the guess fails in both directions — this fixture carries one of each:
 *
 *   - `IMPORTANT NOTICE` is set at twice body size and is not in the outline
 *   - `Chapter One` / `Chapter Two` are set at body size and are in it
 *   - `Section 1.1` is a child, so its level can only come from outline depth
 *
 * Every heading in the fixture is 11 pt, so nothing here can be recovered by
 * measuring.
 */
async function runOutlineHeadingCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>the embedded outline outranks font-size inference</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'outline-headings', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/outline-headings.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'outline-headings.pdf' }, { outputs: ['md'] }, {});
    const md = result.outputs[0].content;
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    record.md = body;

    const headings = [...body.matchAll(/^(#{1,6})\s+(.*)$/gm)].map((m) => [m[1].length, m[2].trim()]);
    const levelOf = (text) => headings.find(([, t]) => t === text)?.[0] ?? null;

    renderChecks(
      box,
      record,
      {
        'an outline entry becomes a heading even at body size': () =>
          levelOf('Chapter One') !== null || `headings were ${JSON.stringify(headings)}`,
        'the second one too, on its own page': () =>
          levelOf('Chapter Two') !== null || 'Chapter Two is not a heading',
        'a nested entry takes its level from outline depth': () =>
          levelOf('Section 1.1') === 2 || `Section 1.1 came out at ${levelOf('Section 1.1')}, expected 2`,
        'a top-level entry takes level 1': () =>
          levelOf('Chapter One') === 1 || `Chapter One came out at ${levelOf('Chapter One')}`,
        'an oversized line the outline does not claim is not a heading': () =>
          levelOf('IMPORTANT NOTICE') === null ||
          `IMPORTANT NOTICE is still an h${levelOf('IMPORTANT NOTICE')}`,
        /**
         * Demotion, not deletion. The outline says the line is not a heading;
         * it says nothing about the line being worth less than its own text.
         */
        'the demoted line keeps its text': () =>
          body.includes('IMPORTANT NOTICE') || 'the text was dropped rather than demoted',
        'body paragraphs are untouched': () =>
          body.includes('The first chapter introduces the subject and sets out the conventions') &&
          body.includes('A subsection whose depth is recorded only in the outline.') ||
          'a paragraph was damaged',
        'the metadata title is still emitted once': () =>
          (body.match(/^#\s+Evaluation Copy$/gm) || []).length === 1 || 'the cover title changed',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('outline-headings', err);
  }
}

/**
 * A decorative glyph must not decide that its line is a heading (Q2, #10).
 *
 * A line's size is the maximum over its glyph runs, so a bullet drawn larger
 * than the text it introduces carries the whole line over the heading
 * threshold. Measured on a reference document: body text 12.8 pt, bullet glyph
 * 19.2 pt, and 713 list items emitted as h2 headings — 27% of every heading in
 * it.
 *
 * The controls are the point. `Findings` is a real heading and has to stay one;
 * `1. Overview of the Quarter` opens with something a list-marker test also
 * matches, so a fix that reorders the tests carelessly turns a paragraph into
 * an ordered list. Markdown renders those two identically, which is why this
 * case reads the JSON block types rather than the text.
 */
async function runOversizedBulletCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>an oversized bullet glyph does not make a heading</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'oversized-bullet', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/oversized-bullet.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'oversized-bullet.pdf' }, { outputs: ['md', 'json'] }, {});
    const md = result.outputs.find((o) => o.format === 'md').content;
    const doc = JSON.parse(result.outputs.find((o) => o.format === 'json').content);
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    record.md = body;

    const headings = [...body.matchAll(/^(#{1,6})\s+(.*)$/gm)].map((m) => [m[1].length, m[2].trim()]);
    const blockFor = (needle) => doc.blocks.find((b) => (b.text || '').includes(needle));

    renderChecks(
      box,
      record,
      {
        'no heading opens with a bullet glyph': () =>
          !headings.some(([, t]) => t.startsWith('•')) ||
          `still headings: ${JSON.stringify(headings.filter(([, t]) => t.startsWith('•')).slice(0, 2))}`,
        'the bulleted lines became a list': () =>
          blockFor('Eastern corridor exceeded')?.type === 'list' ||
          `block type was ${blockFor('Eastern corridor exceeded')?.type}`,
        'all three items are in it': () => {
          const block = blockFor('Eastern corridor exceeded');
          return (
            (block?.items?.length === 3 && /Northern corridor/.test(block.text || '')) ||
            `list had ${block?.items?.length} item(s)`
          );
        },
        'the item text survives whole': () =>
          body.includes('Western corridor met its target with no reported incidents at all') ||
          'item text was damaged',
        'a genuinely large heading is still a heading': () =>
          headings.some(([lvl, t]) => t === 'Findings' && lvl === 2) ||
          `Findings came out as ${JSON.stringify(headings.filter(([, t]) => t === 'Findings'))}`,
        /**
         * A preservation control, not a target. This line is an ordered list
         * item today and must still be one afterwards — it opens with something
         * both the marker test and the numbered-heading rule match, so it is
         * the line most likely to move if either is touched carelessly. In
         * Markdown a paragraph reading "1. Overview" and an ordered list item
         * are the same characters, so only the block model can tell.
         */
        'a numbered line keeps the classification it already had': () =>
          blockFor('Overview of the Quarter')?.type === 'list' ||
          `block type was ${blockFor('Overview of the Quarter')?.type}, expected list`,
        'the body paragraph is untouched': () =>
          body.includes('Throughput was measured weekly at each site and aggregated by region') ||
          'the paragraph was damaged',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('oversized-bullet', err);
  }
}

/**
 * The same glyphs printed twice to fake a bold weight (Q3, #11).
 *
 * Measured on a 1,010-page reference document: 86 headings arrive as
 * `August 2026August 2026` because no bold face is embedded and the producer
 * nudges 0.28 pt and reprints. Both copies are real ink; the assembler groups
 * runs by baseline and concatenates them.
 *
 * The three controls all repeat text and none repeat position — `had had` and
 * `that that` are ordinary English, and the two `Total` cells sit a column
 * apart. Deduplicating on text would eat them, which is why the fix rests on
 * position.
 */
async function runOverprintCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>faux-bold overprint collapses, real repetition survives</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'overprint-heading', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/overprint-heading.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'overprint-heading.pdf' }, { outputs: ['md'] }, {});
    const md = result.outputs[0].content;
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    record.md = body;

    renderChecks(
      box,
      record,
      {
        'the overprinted heading is emitted once': () =>
          !body.includes('August 2026August 2026') || 'the doubled heading survived',
        'and it is still there': () =>
          /August 2026/.test(body) || 'the heading was dropped rather than collapsed',
        'exactly one copy of it': () =>
          (body.match(/August 2026/g) || []).length === 1 ||
          `${(body.match(/August 2026/g) || []).length} copies`,
        'a legitimately repeated word survives': () =>
          body.includes('had had to be restated') || '"had had" was collapsed',
        'and another one': () =>
          body.includes('that that decision was reversed') || '"that that" was collapsed',
        'a repeated table label a column away survives twice': () =>
          (body.match(/Total/g) || []).length === 2 ||
          `${(body.match(/Total/g) || []).length} occurrence(s) of Total, expected 2`,
        'body text is untouched': () =>
          body.includes('Both columns above are labelled identically by design.') ||
          'the closing paragraph was damaged',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('overprint-heading', err);
  }
}

/**
 * A column header wrapped across several visual lines is one header row
 * (Q4, #9).
 *
 * Reference-manual tables print a stacked, bottom-aligned header:
 *
 *                                 Enabled for      Requires       Contact
 *                  Enabled for   administrators  administrator  Salesforce to
 *      Feature        users       /developers        setup         enable
 *
 * Measured on a 1,010-page document, 87 of 209 tables opened with that stack
 * read as a header plus two junk data rows, and only 2 came out right. Two
 * independent implementations assemble it correctly from the same positional
 * data, so the fragments already say what is header and what is body: the
 * row-label column is empty on every stack line but the last, which is exactly
 * what a wrapped data row never does — its label continues in that column.
 *
 * The second table in the fixture is an ordinary one-line header and must come
 * out byte for byte as it did before.
 */
async function runStackedHeaderCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>a stacked column header assembles into one header row</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'stacked-header', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/stacked-header.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'stacked-header.pdf' }, { outputs: ['md', 'json'] }, {});
    const md = result.outputs.find((o) => o.format === 'md').content;
    const doc = JSON.parse(result.outputs.find((o) => o.format === 'json').content);
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    record.md = body;

    const rows = body.split('\n').filter((l) => l.startsWith('|'));
    const first = rows[0] || '';

    renderChecks(
      box,
      record,
      {
        'the stack becomes one header row': () =>
          /Enabled for<br>administrators/.test(first) ||
          `header row was ${JSON.stringify(first.slice(0, 90))}`,
        'the row-label column is headed': () =>
          /\|\s*Feature\s*\|/.test(first) || 'the Feature label is not in the header row',
        'every stack label reaches it': () =>
          ['Enabled for', 'users', 'administrators', 'Requires', 'setup', 'Contact', 'enable'].every(
            (t) => first.includes(t)
          ) || `header row lost labels: ${JSON.stringify(first.slice(0, 90))}`,
        'no junk data row is left behind': () =>
          !rows.slice(2).some((r) => /administrators/.test(r) || /\/developers/.test(r)) ||
          'a header fragment is still a data row',
        'the wrapped data row keeps its whole label': () =>
          rows.some((r) => r.includes('Align Demand Plans with Product Demand Insights')) ||
          'the wrapped row label was damaged',
        'the data rows survive with their values': () =>
          rows.filter((r) => /\bYes\b/.test(r)).length === 3 ||
          `${rows.filter((r) => /\bYes\b/.test(r)).length} row(s) carry a value, expected 3`,
        /**
         * The break has to be a real element, not four escaped characters that
         * happen to survive the trip to Markdown looking right. T1 set this
         * contract for definition pairs and it holds for stacked headers too:
         * every emitter sees a break, and the JSON carries no markup.
         */
        'the break is structure, not literal characters': () => {
          const header = doc.blocks.find((b) => b.type === 'table');
          const text = JSON.stringify(header?.header || header?.text || '');
          return !text.includes('<br>') || `JSON carries literal markup: ${text.slice(0, 80)}`;
        },
        'an ordinary single-line header is untouched': () =>
          body.includes('| Region | Volume | Change |') || 'the control table changed',
        'and its rows too': () =>
          body.includes('| East | 18,420 | +11% |') && body.includes('| West | 12,110 | +3% |') ||
          'the control table rows changed',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('stacked-header', err);
  }
}

/**
 * A table continued on the next page is one table (Q5, #13).
 *
 * A long table reprints its column header at the top of every continuation
 * page. Read page by page that is two tables, and a reader or a chunker gets
 * two where the document has one. Measured on a 1,010-page document: 33 tables
 * cross a single page boundary and none were joined — nor were they by either
 * reference implementation, so this is a shared gap rather than a competitive
 * one.
 *
 * The third page is the control. Its table sits directly after a page break too
 * and its header is different, so it must stay separate — proximity is not
 * evidence, a matching header is.
 */
async function runTableContinuationCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>a table continued across a page break is merged</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'table-continuation', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/table-continuation.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'table-continuation.pdf' }, { outputs: ['md', 'json'] }, {});
    const md = result.outputs.find((o) => o.format === 'md').content;
    const doc = JSON.parse(result.outputs.find((o) => o.format === 'json').content);
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    record.md = body;

    const headerRows = (body.match(/^\| Feature \| Available \| Notes \|$/gm) || []).length;
    const dataRows = body.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*---/.test(l));
    const tables = doc.blocks.filter((b) => b.type === 'table');

    renderChecks(
      box,
      record,
      {
        'the repeated header appears once': () =>
          headerRows === 1 || `${headerRows} copies of the header row`,
        'the continuation is one table with the first': () =>
          tables.length === 2 || `${tables.length} tables, expected 2`,
        'every row from both pages is present': () => {
          const wanted = [
            'Adaptive routing for inbound cases',
            'Bulk reassignment of open work',
            'Scheduled export of audit',
            'trails to external storage',
            'Inline translation of case replies',
            'Retention policy per record type',
          ];
          const missing = wanted.filter((t) => !body.includes(t));
          return !missing.length || `missing ${JSON.stringify(missing)}`;
        },
        'no row was duplicated by the merge': () =>
          dataRows.filter((r) => r.includes('Adaptive routing')).length === 1 ||
          'a row appears more than once',
        'the values travel with their rows': () =>
          body.includes('| Inline translation of case replies | Yes | Pilot |') ||
          'a merged row lost its values',
        /**
         * The control. This table also sits directly after a page break; only
         * its header differs, and that has to be enough to keep it separate.
         */
        'a different table after a page break is not swallowed': () =>
          body.includes('| Region | Volume | Change |') || 'the control table disappeared',
        'and it keeps its own rows': () =>
          body.includes('| Eastern corridor | 18,420 | plus 11 percent |') ||
          'the control table lost a row',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('table-continuation', err);
  }
}

/**
 * An image we cannot convert has to say so (Q6, #12).
 *
 * The PDF adapter reads images only to measure a scan's resolution and never
 * emits one. On a reference document that meant 161 placements across 131 pages
 * produced nothing at all — no placeholder, no marker, no warning — and a reader
 * had no way to know a diagram had been there.
 *
 * Extraction is out of scope this cycle. Saying so is not.
 *
 * Page 1 draws the same image object twice. The output must carry one line for
 * the page, not one per placement: a logo repeated down a document must not
 * bury the content under placeholders.
 */
async function runDroppedImageCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>an unconverted image is declared, once per page</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: 'dropped-image', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const bytes = new Uint8Array(await (await fetch('fixtures/dropped-image.pdf')).arrayBuffer());
    const result = await convertFile({ bytes, name: 'dropped-image.pdf' }, { outputs: ['md'] }, {});
    const md = result.outputs[0].content;
    record.warnings = result.warnings;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    record.md = body + '\n\n' + JSON.stringify(result.warnings);

    const markers = body.match(/<!-- SUMCHECK: [^>]*image[^>]*-->/g) || [];

    renderChecks(
      box,
      record,
      {
        'the output declares the image': () =>
          markers.length > 0 || 'no image marker anywhere in the output',
        'the marker names the page': () =>
          markers.some((m) => /page 1\b/.test(m)) || `markers were ${JSON.stringify(markers)}`,
        'both pages are declared': () =>
          markers.some((m) => /page 2\b/.test(m)) || 'page 2 was not declared',
        /**
         * Page 1 paints the same object twice. One line per page, never one per
         * placement — otherwise a repeated logo buries the document.
         */
        'one declaration per page, not per placement': () =>
          markers.length === 2 || `${markers.length} markers for 2 pages`,
        'a reader sees something, not just a comment': () =>
          /\(image not converted\)/i.test(body) || 'no visible placeholder beside the marker',
        /**
         * Turndown escapes `[` as `\[` because it could open a link, and the
         * backslashes reach the reader. The placeholder uses parentheses.
         */
        'the placeholder carries no escape artefacts': () =>
          !/\\\[|\\\]/.test(body) || 'the placeholder reached the output with backslashes in it',
        'the result notes carry a count': () =>
          result.warnings.some((w) => /image/i.test(w) && /\d/.test(w)) ||
          `warnings were ${JSON.stringify(result.warnings)}`,
        'the surrounding text is untouched': () =>
          body.includes('The diagram below shows the request flow.') &&
          body.includes('The text around it must be unaffected.') ||
          'text near the image was damaged',
      },
      record.md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('dropped-image', err);
  }
}

const summary = document.getElementById('summary');
const container = document.getElementById('cases');
const results = [];
window.__results = results;
window.__done = false;

run();

async function run() {
  for (const testCase of CASES) {
    await runCase(testCase);
  }
  for (const testCase of SYNTHETIC_CASES) {
    await runSynthetic(testCase);
  }
  /**
   * Run each hand-written case in isolation.
   *
   * These used to be awaited in a straight line, so a case that threw before
   * registering its own record — a typo in a helper name was enough — aborted
   * the run and took every case after it with it. The suite then reported
   * "30/30 cases passed": green, having silently skipped eight cases including
   * every OCR document. A skipped case now fails loudly instead.
   */
  const UNIT_CASES = [
    ['ocr-worker-parameters', runWorkerParameterCase],
    ['ocr-confidence-shape', runConfidenceShapeCase],
    ['ocr-heading-rejection', runHeadingRejectionCase],
    ['ocr-rescue-dedup', runRescueDedupCase],
    ['prose-lexicon', runProseLexiconCase],
    ['locked.pdf', runPasswordCase],
    ['field-details.pdf', runFieldDetailsCase],
    ['page-chrome', runPageChromeCase],
    ['split-title', runSplitTitleCase],
    ['diagnostics', runDiagnosticsCase],
    ['outline-headings', runOutlineHeadingCase],
    ['oversized-bullet', runOversizedBulletCase],
    ['overprint-heading', runOverprintCase],
    ['stacked-header', runStackedHeaderCase],
    ['table-continuation', runTableContinuationCase],
    ['dropped-image', runDroppedImageCase],
    ['i18n-fallback', runI18nFallbackCase],
    ['ocr.png', runOcrCase],
    ['scanned.pdf', runScannedPdfCase],
    ['billing-form.pdf', runBillingFormCase],
    ['shaded-callout.pdf', runShadedCalloutCase],
    ['fragment-headings.pdf', runFragmentHeadingCase],
    ['inverted-banner.pdf', runInvertedBannerCase],
    ['corpus-callout.pdf', runCorpusCalloutCase],
  ];
  for (const [name, fn] of UNIT_CASES) {
    try {
      await fn();
    } catch (err) {
      console.error(name, err);
    }
    // A case that never got as far as pushing its record did not run, and that
    // must not read as an absence of cases.
    if (!results.some((r) => r.name === name)) {
      results.push({
        name,
        pass: false,
        failures: [`the case did not run — it threw before registering (see console)`],
        warnings: [],
      });
    }
  }
  await terminateOcr();

  const failed = results.filter((r) => !r.pass);
  summary.className = failed.length ? 'bad' : 'ok';
  summary.textContent = failed.length
    ? `${failed.length} of ${results.length} cases FAILED`
    : `all ${results.length} cases passed`;
  window.__done = true;
}

async function runCase({ file, options = {}, checks }) {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>${file}</h2><div class="body">running…</div>`;
  container.appendChild(box);

  const record = { name: file, pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const response = await fetch(`fixtures/${file}`);
    if (!response.ok) throw new Error(`fixture missing (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const started = performance.now();
    const result = await convertFile({ bytes, name: file }, options, {});
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;

    const md = result.outputs.find((o) => o.format === 'md').content;
    record.md = md;
    renderChecks(box, record, checks, md, result);
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error(file, err);
  }
}

/** OCR is verified against an image rendered here, so no binary fixture is needed. */
async function runOcrCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>generated PNG (OCR)</h2><div class="body">running OCR — this takes a few seconds…</div>`;
  container.appendChild(box);

  const record = { name: 'ocr.png', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 58px Georgia, serif';
    ctx.fillText('Annual Safety Notice', 60, 100);
    ctx.font = '30px Georgia, serif';
    ctx.fillText('All contractors must complete the refresher course', 60, 190);
    ctx.fillText('before the first of March. Records are kept by the', 60, 240);
    ctx.fillText('site office for a period of seven years.', 60, 290);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const started = performance.now();
    const result = await convertFile(
      { bytes, name: 'ocr.png', mime: 'image/png' },
      { outputs: ['md'], imageMode: 'strip' },
      {}
    );
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs[0].content;
    record.md = md;

    renderChecks(
      box,
      record,
      {
        'recognized the heading': (text) => /Annual Safety Notice/i.test(text) || 'heading not recognized',
        'heading promoted by type size': matches(/^#{1,2} .*Annual Safety Notice/im),
        'recognized body text': (text) =>
          /contractors must complete the refresher/i.test(text) || 'body text not recognized',
        'lines merged into a paragraph': (text) =>
          /before the first of March\.?\s+Records/i.test(text) || 'OCR line breaks were not merged',
      },
      md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('ocr', err);
  }
}

/**
 * The scanned-document path: a PDF whose only content is a photograph of text.
 * Built here rather than checked in, so the image and the expected text stay in
 * one place.
 */
async function runScannedPdfCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>image-only PDF (OCR fallback)</h2><div class="body">building a scanned PDF and running OCR…</div>`;
  container.appendChild(box);

  const record = { name: 'scanned.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1224; // 8.5in at 144 dpi
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 56px Georgia, serif';
    ctx.fillText('Invoice Summary', 70, 110);
    ctx.font = '32px Georgia, serif';
    ctx.fillText('Payment is due within thirty days of receipt.', 70, 210);
    ctx.fillText('Late payments accrue interest at one percent', 70, 260);
    ctx.fillText('per month on the outstanding balance.', 70, 310);

    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    const bytes = buildImagePdf(jpeg, canvas.width, canvas.height);

    const started = performance.now();
    const result = await convertFile(
      { bytes, name: 'scanned.pdf' },
      { outputs: ['md'], ocrMode: 'auto' },
      {}
    );
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs[0].content;
    record.md = md;

    renderChecks(
      box,
      record,
      {
        'page had no text layer and was OCR-ed': (text, r) =>
          r.meta.ocrPages === 1 || `ocrPages was ${r.meta.ocrPages}`,
        'recognized the heading': (text) => /Invoice Summary/i.test(text) || 'heading not recognized',
        'heading promoted on an OCR page': matches(/^#{1,3} .*Invoice Summary/im),
        'recognized the body': (text) =>
          /within thirty days of receipt/i.test(text) || 'body text not recognized',
        'front matter records the OCR': has('ocr_pages: 1'),
        'warns that OCR was used': (text, r) =>
          r.warnings.some((w) => /OCR/.test(w)) || 'no OCR warning surfaced',
      },
      md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('scanned pdf', err);
  }
}

/**
 * The billing-form regression: a 96 dpi scan of a document whose *structure is
 * the data*. Modelled on an audited 50-file batch of Good Faith Estimates that
 * exposed the whole defect class:
 *
 *   - "$" eaten by resampling and read as "3", inflating a price ~8.5x
 *   - a headline figure inside a shaded box dropped while its label survived
 *   - a services table flattened into a run-on paragraph, so no charge could be
 *     attributed to its procedure code
 *   - a URL and a semicolon in a CPT descriptor corrupted
 *
 * Everything is drawn at 96 dpi with small type, which is the hard case: it is
 * what a fax or an ABCpdf export actually looks like.
 */
async function runBillingFormCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>96 dpi billing form (structure-is-data)</h2><div class="body">rendering and OCR-ing…</div>`;
  container.appendChild(box);

  const record = { name: 'billing-form.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 816; // 8.5in at 96 dpi — the resolution of the audited corpus
    canvas.height = 1056;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';

    ctx.font = 'bold 19px Helvetica, Arial, sans-serif';
    ctx.fillText('Good Faith Estimate', 48, 56);
    ctx.font = '12px Helvetica, Arial, sans-serif';
    ctx.fillText('Northwest Imaging Center, 14835 Southwest Fwy, Suite 200', 48, 80);

    // The shaded callout: label outside, headline figure inside.
    // A medium-grey callout is the documented killer: Tesseract binarizes the
    // box to one dark mass and drops label and value together. Only the rescue
    // pass gets these two lines back.
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(48, 100, 300, 54);
    ctx.fillStyle = '#000';
    ctx.font = '12px Helvetica, Arial, sans-serif';
    ctx.fillText('Total Estimated Costs:', 58, 120);
    ctx.font = 'bold 22px Helvetica, Arial, sans-serif';
    ctx.fillText('$600.00', 58, 146);

    // The services table: five columns, three body rows.
    const cols = [48, 150, 470, 545, 660];
    const header = ['Service Date', 'Description', 'Quantity', 'Charge', 'Total'];
    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    header.forEach((h, i) => ctx.fillText(h, cols[i], 200));
    ctx.font = '11px Helvetica, Arial, sans-serif';
    // Descriptions that wrap to a second line are the shape that broke table
    // detection on the real corpus: the continuation is a lone fragment that
    // used to end the run and get printed after the numeric columns.
    const rows = [
      {
        cells: ['08-13-2026', '74183 MR ABDOMEN; WITHOUT CONTRAST', '1', '$400.00', '$400.00'],
        wrap: 'AND WITH CONTRAST MATERIAL(S)',
      },
      {
        cells: ['08-13-2026', '77067 Screening mammography, bilateral', '1', '$140.00', '$140.00'],
        wrap: '(2-view study of each breast)',
      },
      { cells: ['08-13-2026', '70551 MR brain w/o contrast', '1', '$60.00', '$60.00'] },
    ];
    let y = 224;
    for (const row of rows) {
      row.cells.forEach((cell, i) => ctx.fillText(cell, cols[i], y));
      y += 18;
      if (row.wrap) {
        ctx.fillText(row.wrap, cols[1], y);
        y += 18;
      }
    }
    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ['Total', '', '3', '$600.00', '$600.00'].forEach((cell, i) => {
      if (cell) ctx.fillText(cell, cols[i], y + 6);
    });

    // Well clear of the table. Real forms leave roughly two rows of air before
    // the following paragraph; drawing it tight against the last row made this
    // fixture argue for a rule that broke every real document.
    ctx.font = '11px Helvetica, Arial, sans-serif';
    ctx.fillText('For questions about your rights, go to www.cms.gov/nosurprises', 48, y + 70);

    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    const bytes = buildImagePdf(jpeg, canvas.width, canvas.height, 96);

    const started = performance.now();
    const result = await convertFile({ bytes, name: 'billing-form.pdf' }, { outputs: ['md', 'json'] }, {});
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs.find((o) => o.format === 'md').content;
    record.md = md;

    const amounts = md.match(/\d+\.\d{2}/g) || [];
    renderChecks(
      box,
      record,
      {
        'upscaled the 96 dpi scan past 180 dpi': (t, r) =>
          Number(r.meta.ocrDpi) >= 180 || `OCR ran at ${r.meta.ocrDpi} dpi`,
        'no "$" eaten into the number': () =>
          !/(^|[\s|])\d{3}\.\d{2}/m.test(md.replace(/\$\d[\d,]*\.\d{2}/g, '')) ||
          `bare amounts present: ${amounts.join(', ')}`,
        'currency amounts kept their sigil': has('$400.00'),
        'headline label recovered from the shaded box': has('Total Estimated Costs'),
        'headline figure recovered from the shaded box': () =>
          /\$600\.00/.test(md) || 'the shaded callout value was not recovered',
        'services table is a table, not a paragraph': () =>
          /^\|.*\|$/m.test(md) || /^```/m.test(md) || 'no table or aligned block emitted',
        'charge stays on its procedure code row': () => {
          const row = md.split('\n').find((l) => /74183/.test(l));
          return (row && /400\.00/.test(row)) || `74183 row was "${row || 'missing'}"`;
        },
        'a second code keeps its own charge': () => {
          const row = md.split('\n').find((l) => /77067/.test(l));
          return (row && /140\.00/.test(row)) || `77067 row was "${row || 'missing'}"`;
        },
        'wrapped description rejoins its row, not the amounts': () => {
          const row = md.split('\n').find((l) => /74183/.test(l)) || '';
          if (!/MATERIAL\(S\)/.test(row)) return 'the wrapped continuation is not on its row';
          // It must sit with the description, before the numeric columns.
          return (
            row.indexOf('MATERIAL(S)') < row.indexOf('400.00') ||
            'the wrapped text landed after the money columns'
          );
        },
        'semicolon in the CPT descriptor survived': has('ABDOMEN;'),
        'URL is intact and unescaped': () =>
          /www\.cms\.gov\/nosurprises/.test(md) || 'the URL was corrupted',
        'footer prose stays out of the table': () => {
          const total = md.split('\n').find((l) => /^\|\s*Total/.test(l)) || '';
          return !/questions about your rights/.test(total) || 'the footer was absorbed into the total row';
        },
        'confidence recorded in front matter': matches(/ocr_confidence_mean: \d/),
        'low-confidence words listed': (t, r) =>
          r.meta.ocrFlaggedFields === 0 || /ocr_low_confidence:/.test(md) ||
          'flagged words were counted but not listed',
      },
      md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('billing form', err);
  }
}

/**
 * The rescue pass, isolated.
 *
 * A figure printed inside a mid-grey callout is the documented way to lose the
 * single most important number on a page: the box binarizes to one dark mass
 * and its contents disappear, label and value together, silently. Measured on
 * this exact input, the first OCR pass returns neither line.
 *
 * Asserts the second, contrast-boosted pass gets them back — and that it is
 * credited, so a reader knows those lines came from a harder read.
 */
async function runShadedCalloutCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>shaded callout (OCR rescue)</h2><div class="body">running two OCR passes…</div>`;
  container.appendChild(box);

  const record = { name: 'shaded-callout.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 816;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(30, 20, 320, 70);
    ctx.fillStyle = '#000';
    ctx.font = '11px Helvetica, Arial, sans-serif';
    ctx.fillText('Total Estimated Costs:', 40, 45);
    ctx.font = 'bold 20px Helvetica, Arial, sans-serif';
    ctx.fillText('$7,311.39', 40, 80);
    ctx.font = '11px Helvetica, Arial, sans-serif';
    ctx.fillText('Tax ID: 04-3642199   Items included   Code', 40, 160);

    // A signature-like scrawl: ink that OCR cannot turn into words, which is
    // what forces the unrecognized-ink path and the rescue pass to actually
    // run. Every earlier fixture had zero unread ink, so that whole branch went
    // untested — and shipped with a fatal error that only fired on real scans.
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(430, 200);
    for (let i = 0; i < 60; i++) {
      ctx.lineTo(430 + i * 5, 200 + Math.sin(i / 2) * 18 + Math.cos(i / 5) * 10);
    }
    ctx.stroke();

    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    const bytes = buildImagePdf(jpeg, canvas.width, canvas.height, 96);

    const started = performance.now();
    const result = await convertFile({ bytes, name: 'shaded-callout.pdf' }, { outputs: ['md'] }, {});
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs[0].content;
    record.md = md;

    // The same page again, asking for the full per-word detail.
    const detailed = await convertFile(
      { bytes: buildImagePdf(jpeg, canvas.width, canvas.height, 96), name: 'shaded-callout.pdf' },
      { outputs: ['md'], ocrDetail: 'full' },
      {}
    );
    const detailedMd = detailed.outputs[0].content;

    renderChecks(
      box,
      record,
      {
        'the shaded label was recovered': has('Total Estimated Costs'),
        'the shaded figure was recovered': has('7,311.39'),
        // The rescue is a fallback: it fires only when the first pass leaves ink
        // unaccounted for, so the assertion is on the outcome, not the path.
        'nothing was silently dropped': () =>
          !/ocr_unreadable_regions: [1-9]/.test(md) || /SUMCHECK: value not recovered/.test(md) ||
          'an unread region was reported with no marker in the body',
        'confidence scalars are always recorded': matches(/ocr_confidence_mean: \d/),
        'the unread-ink path ran without throwing': (t, r) =>
          !r.warnings.some((w) => /OCR failed/.test(w)) || `OCR errored: ${r.warnings.join('; ')}`,
        'ink that is not text is reported, not ignored': (t, r) =>
          (r.meta.ocrUnreadableRegions ?? 0) > 0 ||
          /SUMCHECK: value not recovered/.test(md) ||
          'the scrawl produced no unreadable-region signal',
        'the per-word list is omitted by default': lacks('ocr_low_confidence:'),
        'and is available on request': () =>
          /ocr_flagged_fields: 0/.test(detailedMd) || /ocr_low_confidence:/.test(detailedMd) ||
          'ocrDetail: full did not emit the word list',
      },
      md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('shaded callout', err);
  }
}

/**
 * Wrapped table-cell text must not become a heading.
 *
 * On a scan, heading depth is inferred from glyph height, and OCR measures that
 * inconsistently — so the tail of a wrapped CPT descriptor gets promoted to an
 * `####`. Observed on the real corpus as `#### MATERIAL(S)`,
 * `#### (EG, FOR FOLLICLES)` and `#### 08-14-2026 CT Angiography Coronary…`;
 * this fixture reproduces all three shapes.
 */
async function runFragmentHeadingCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>wrapped cell fragments are content, not headings</h2><div class="body">rendering and OCR-ing…</div>`;
  container.appendChild(box);

  const record = { name: 'fragment-headings.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 816;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';

    ctx.font = 'bold 17px Helvetica, Arial, sans-serif';
    ctx.fillText('Good Faith Estimate for Health Care Items and Services', 48, 50);

    const cols = [48, 150, 470, 545, 660];
    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ['Service Date', 'Description', 'Quantity', 'Charge', 'Total'].forEach((h, i) =>
      ctx.fillText(h, cols[i], 120)
    );
    ctx.font = '11px Helvetica, Arial, sans-serif';

    // Each row's descriptor wraps to a fragment of a different awkward shape.
    const rows = [
      { cells: ['08-14-2026', '74183 MR ABDOMEN WITH CONTRAST', '1', '$400.00', '$400.00'], wrap: 'MATERIAL(S)' },
      { cells: ['08-14-2026', '76817 US PELVIS LIMITED', '1', '$140.00', '$140.00'], wrap: '(EG, FOR FOLLICLES)' },
      { cells: ['08-14-2026', '75574 CT Angiography Coronary', '1', '$60.00', '$60.00'], wrap: '08-14-2026 CT Angiography Coronary (Coronary CTA/CCTA)' },
    ];
    let y = 150;
    for (const row of rows) {
      row.cells.forEach((cell, i) => ctx.fillText(cell, cols[i], y));
      y += 15;
      ctx.fillText(row.wrap, cols[1], y);
      y += 26;
    }
    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ['Total', '', '3', '$600.00', '$600.00'].forEach((cell, i) => {
      if (cell) ctx.fillText(cell, cols[i], y + 6);
    });

    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    const bytes = buildImagePdf(jpeg, canvas.width, canvas.height, 96);

    const started = performance.now();
    const result = await convertFile({ bytes, name: 'fragment-headings.pdf' }, { outputs: ['md'] }, {});
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs[0].content;
    record.md = md;
    const headings = md.match(/^#{1,6} .*$/gm) || [];

    renderChecks(
      box,
      record,
      {
        'no heading deeper than ## on a scanned page': () =>
          !headings.some((h) => /^#{3,} /.test(h)) ||
          `deep headings emitted: ${JSON.stringify(headings.filter((h) => /^#{3,} /.test(h)))}`,
        'MATERIAL(S) is not a heading': () =>
          !headings.some((h) => /MATERIAL\(S\)/.test(h)) || 'the wrapped fragment became a heading',
        'the parenthetical fragment is not a heading': () =>
          !headings.some((h) => /FOLLICLES/i.test(h)) || 'the parenthetical fragment became a heading',
        'the date-leading fragment is not a heading': () =>
          !headings.some((h) => /^#+\s*\d{2}-\d{2}-\d{4}/.test(h)) ||
          'the date-leading fragment became a heading',
        'the document title still is a heading': () =>
          headings.some((h) => /^#{1,2} .*Good Faith Estimate/.test(h)) ||
          `title lost; headings were ${JSON.stringify(headings)}`,
        'the fragments survive as content': () =>
          /MATERIAL\(S\)/.test(md) || 'the fragment text was dropped entirely',
      },
      md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('fragment headings', err);
  }
}

/**
 * A reversed-out banner is not unread content.
 *
 * The ink detector counts dark pixels and subtracts the areas covered by
 * recognized words. A title set in white on a solid black bar defeats that
 * completely: the bar is ~50% "ink", the word boxes cover only the white
 * glyphs, and the band is reported as unread — which on the real corpus
 * produced a spurious "value not recovered" marker in 48 files that were
 * missing nothing, and a duplicate title line in all 50 when the rescue pass
 * re-read the band it should never have been given.
 */
async function runInvertedBannerCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>reversed-out banner is not unread ink</h2><div class="body">rendering and OCR-ing…</div>`;
  container.appendChild(box);

  const record = { name: 'inverted-banner.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 816;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // The banner: white text on a solid black bar, with the stray white block
    // that the real documents carry at the right-hand end.
    ctx.fillStyle = '#000';
    ctx.fillRect(40, 40, 736, 46);
    ctx.fillStyle = '#fff';
    ctx.fillRect(742, 46, 28, 34);
    ctx.font = '20px Helvetica, Arial, sans-serif';
    ctx.fillText('Good Faith Estimate for Health Care Items and Services', 60, 72);

    ctx.fillStyle = '#000';
    ctx.font = '13px Helvetica, Arial, sans-serif';
    ctx.fillText('Estimate Prepared on: 08-14-2026 12:32 PM', 40, 140);
    ctx.fillText('Tax ID: 04-3642199', 40, 170);

    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    const bytes = buildImagePdf(jpeg, canvas.width, canvas.height, 96);

    const started = performance.now();
    const result = await convertFile({ bytes, name: 'inverted-banner.pdf' }, { outputs: ['md'] }, {});
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs[0].content;
    record.md = md;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    const titleCount = (body.match(/Good Faith Estimate for Health Care/g) || []).length;

    renderChecks(
      box,
      record,
      {
        'the banner is not reported as unread ink': (t, r) =>
          (r.meta.ocrUnreadableRegions ?? 0) === 0 ||
          `${r.meta.ocrUnreadableRegions} region(s) flagged — the black bar is being counted as ink`,
        'no spurious not-recovered marker': () =>
          !/SUMCHECK: value not recovered/.test(body) ||
          'a marker fired on a page where nothing is missing',
        'the banner title is read once, not twice': () =>
          titleCount === 1 || `the title appears ${titleCount} times — the rescue duplicated it`,
        'body text still reads': () => /3642199/.test(body) || 'the ordinary text was lost',
      },
      md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('inverted banner', err);
  }
}

/**
 * The headline figure, on a real corpus page.
 *
 * `test/fixtures/callout-page.png` is an actual rendered page from the audit
 * batch (synthetic documents, confirmed by the owner). It has to be the whole
 * page: the failure is Tesseract's *page-level* layout analysis discarding the
 * block that holds the total, so a cropped fixture would not reproduce it —
 * cropping is the cure, not the disease.
 *
 * Measured on this page: the whole-page pass never emits `$226.00` from the
 * callout, while the same pixels cropped to the flagged region read it at 77.
 */
async function runCorpusCalloutCase() {
  const box = document.createElement('div');
  box.className = 'case';
  box.innerHTML = `<h2>headline total on a real corpus page</h2><div class="body">converting…</div>`;
  container.appendChild(box);

  const record = { name: 'corpus-callout.pdf', pass: false, failures: [], warnings: [] };
  results.push(record);

  try {
    const png = new Uint8Array(await (await fetch('fixtures/callout-page.png')).arrayBuffer());
    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    // Re-encode to JPEG so the PDF can carry it with /DCTDecode, at the same
    // pixel dimensions the corpus page was rendered at.
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.97));
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    // The raster is 192 dpi; wrapping it at 192 reproduces the original page.
    const bytes = buildImagePdf(jpeg, bitmap.width, bitmap.height, 192);

    const started = performance.now();
    const result = await convertFile({ bytes, name: 'corpus-callout.pdf' }, { outputs: ['md'] }, {});
    record.ms = Math.round(performance.now() - started);
    record.warnings = result.warnings;
    const md = result.outputs[0].content;
    record.md = md;
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    const lines = body.split('\n');
    const labelLine = lines.findIndex((l) => /Total Estimated Costs:/.test(l));

    renderChecks(
      box,
      record,
      {
        'the headline label is read': () => labelLine >= 0 || 'the label itself was not read',
        'the headline value is recovered': () =>
          /\$?226\.00/.test(lines.slice(Math.max(0, labelLine), labelLine + 4).join(' ')) ||
          'the value next to the label was not recovered',
        'or, failing that, the miss is marked': () =>
          /226\.00/.test(body) || /SUMCHECK: value not recovered/.test(body) ||
          'the value is missing with no marker — silence is the one unacceptable outcome',
        'the reversed-out banner is still read once': () =>
          (body.match(/Good Faith Estimate for Health Care/g) || []).length === 1 ||
          'the banner was duplicated or lost',
      },
      md,
      result
    );
  } catch (err) {
    record.failures.push(`threw: ${err.message}`);
    box.querySelector('.body').innerHTML = `<span class="fail">ERROR</span> ${escapeHtml(err.message)}`;
    console.error('corpus callout', err);
  }
}

/** Minimal single-page PDF whose only content is one full-bleed JPEG. */
function buildImagePdf(jpeg, width, height, dpi = 144) {
  const scale = 72 / dpi;
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

  const parts = [];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    { image: true },
  ];

  let offset = 0;
  const push = (text) => {
    const bytes = new TextEncoder().encode(text);
    parts.push(bytes);
    offset += bytes.length;
  };
  const offsets = [];

  push('%PDF-1.4\n');
  objects.forEach((body, i) => {
    offsets.push(offset);
    if (body.image) {
      push(
        `${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
      );
      parts.push(jpeg);
      offset += jpeg.length;
      push('\nendstream\nendobj\n');
    } else {
      push(`${i + 1} 0 obj\n${body}\nendobj\n`);
    }
  });

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(xref);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function renderChecks(box, record, checks, md, result) {
  const rows = [];
  for (const [label, check] of Object.entries(checks)) {
    let outcome;
    try {
      outcome = check(md, result);
    } catch (err) {
      outcome = `check threw: ${err.message}`;
    }
    if (outcome === true) rows.push(`<li class="pass">✓ ${escapeHtml(label)}</li>`);
    else {
      record.failures.push(`${label}: ${outcome}`);
      rows.push(`<li class="fail">✗ ${escapeHtml(label)} — ${escapeHtml(String(outcome))}</li>`);
    }
  }
  record.pass = record.failures.length === 0;
  box.querySelector('h2').innerHTML = `${escapeHtml(record.name)} <span class="${
    record.pass ? 'pass' : 'fail'
  }">${record.pass ? 'PASS' : 'FAIL'}</span> <small>${record.ms}ms</small>`;
  box.querySelector('.body').innerHTML = `
    <ul>${rows.join('')}</ul>
    ${
      record.warnings.length
        ? `<details><summary>${record.warnings.length} warning(s)</summary><pre>${escapeHtml(
            record.warnings.join('\n')
          )}</pre></details>`
        : ''
    }
    <details><summary>markdown output</summary><pre>${escapeHtml(md)}</pre></details>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
