/**
 * Excel (.xlsx/.xlsm/.xltx) -> HTML tables.
 *
 * Written directly against the SpreadsheetML parts rather than pulling in a
 * spreadsheet library: we only need values, not formulas or styling, and this
 * keeps the dependency surface (and the license surface) small.
 */

import { getJSZip } from '../vendor.js';
import { parseXml, findAll, findFirst, attr, childrenNamed } from '../util/xml.js';
import { escapeHtml } from '../util/misc.js';

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

export async function convertXlsx(bytes, ctx, detected) {
  const zip = detected?.zip || (await getJSZip().loadAsync(bytes));
  ctx.progress(0.05, 'Reading workbook');

  const workbookXml = await readXml(zip, 'xl/workbook.xml');
  const rels = await readRels(zip, 'xl/_rels/workbook.xml.rels');
  const date1904 = attr(findFirst(workbookXml, 'workbookPr'), 'date1904') === '1';
  const shared = await readSharedStrings(zip);
  const styles = await readStyles(zip);

  const sheets = findAll(workbookXml, 'sheet').map((node) => ({
    name: attr(node, 'name') || 'Sheet',
    state: attr(node, 'state') || 'visible',
    path: normalizePart(rels[attr(node, 'r:id') || attr(node, 'id')]),
  }));

  const out = [];
  const warnings = [];
  const opts = ctx.opts;
  let index = 0;

  for (const sheet of sheets) {
    index++;
    ctx.progress(0.05 + (index / Math.max(1, sheets.length)) * 0.9, `Sheet “${sheet.name}”`);
    if (sheet.state !== 'visible' && !opts.includeEmptySheets) continue;
    if (!sheet.path || !zip.file(sheet.path)) {
      warnings.push(`Could not locate the data for sheet “${sheet.name}”.`);
      continue;
    }

    const sheetXml = await readXml(zip, sheet.path);
    const linkRels = await readRels(
      zip,
      sheet.path.replace(/([^/]+)$/, '_rels/$1.rels')
    );
    const grid = readSheet(sheetXml, { shared, styles, date1904, linkRels, opts });

    if (!grid.rows.length) {
      if (opts.includeEmptySheets) {
        out.push(`<h2>${escapeHtml(sheet.name)}</h2><p><em>(empty sheet)</em></p>`);
      }
      continue;
    }
    if (grid.truncated) {
      warnings.push(
        `Sheet “${sheet.name}” was truncated to ${opts.maxSheetRows} rows (raise the limit in Settings).`
      );
    }

    out.push(`<h2>${escapeHtml(sheet.name)}</h2>`);
    out.push(
      opts.sheetMode === 'csv-block' ? renderCsvBlock(grid) : renderTable(grid)
    );
  }

  if (!out.length) out.push('<p><em>This workbook contains no visible data.</em></p>');

  return {
    html: out.join('\n'),
    warnings,
    meta: { kind: 'xlsx', sheets: sheets.length },
  };
}

/* ------------------------------------------------------------------ parts */

async function readXml(zip, path) {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing part: ${path}`);
  return parseXml(await file.async('string'));
}

async function readRels(zip, path) {
  const file = zip.file(path);
  if (!file) return {};
  const doc = parseXml(await file.async('string'));
  const map = {};
  for (const rel of findAll(doc, 'Relationship')) {
    map[attr(rel, 'Id')] = { target: attr(rel, 'Target'), mode: attr(rel, 'TargetMode') };
  }
  return map;
}

function normalizePart(rel) {
  const target = typeof rel === 'string' ? rel : rel?.target;
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  return target.startsWith('xl/') ? target : `xl/${target}`;
}

async function readSharedStrings(zip) {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  const doc = parseXml(await file.async('string'));
  return childrenNamed(doc.documentElement, 'si').map(siText);
}

function siText(si) {
  // A shared string is either <t>text</t> or a sequence of formatted runs.
  const runs = childrenNamed(si, 'r');
  if (runs.length) return runs.map((r) => findFirst(r, 't')?.textContent ?? '').join('');
  return findFirst(si, 't')?.textContent ?? '';
}

async function readStyles(zip) {
  const file = zip.file('xl/styles.xml');
  const result = { isDate: [], formats: [] };
  if (!file) return result;
  const doc = parseXml(await file.async('string'));

  const custom = new Map();
  for (const fmt of findAll(doc, 'numFmt')) {
    custom.set(Number(attr(fmt, 'numFmtId')), attr(fmt, 'formatCode') || '');
  }
  const cellXfs = findFirst(doc, 'cellXfs');
  for (const xf of childrenNamed(cellXfs, 'xf')) {
    const id = Number(attr(xf, 'numFmtId') || 0);
    const code = custom.get(id) || '';
    result.formats.push(code);
    result.isDate.push(BUILTIN_DATE_FORMATS.has(id) || looksLikeDateFormat(code));
  }
  return result;
}

function looksLikeDateFormat(code) {
  if (!code) return false;
  // Strip quoted literals, escaped chars, colors and conditions first.
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(stripped) && !/^[^ymdhs]*$/i.test(stripped);
}

/* ------------------------------------------------------------------ sheet */

function readSheet(sheetXml, { shared, styles, date1904, linkRels, opts }) {
  const links = new Map();
  for (const link of findAll(sheetXml, 'hyperlink')) {
    const rel = linkRels[attr(link, 'r:id') || attr(link, 'id')];
    const href = rel?.target || attr(link, 'location');
    if (href) links.set(attr(link, 'ref'), href);
  }

  const rows = [];
  let maxCol = 0;
  let truncated = false;
  const limit = Number(opts.maxSheetRows) || 5000;

  for (const rowNode of findAll(sheetXml, 'row')) {
    if (rows.length >= limit) {
      truncated = true;
      break;
    }
    const cells = [];
    for (const cellNode of childrenNamed(rowNode, 'c')) {
      const ref = attr(cellNode, 'r') || '';
      const col = columnIndex(ref);
      const value = cellValue(cellNode, { shared, styles, date1904 });
      if (value === '' ) continue;
      cells[col] = links.has(ref) ? { text: value, href: links.get(ref) } : { text: value };
      if (col + 1 > maxCol) maxCol = col + 1;
    }
    rows.push(cells);
  }

  // Drop fully-empty leading/trailing rows.
  while (rows.length && !rows[0].some(Boolean)) rows.shift();
  while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();

  // Drop trailing empty columns.
  const used = new Array(maxCol).fill(false);
  for (const row of rows) for (let c = 0; c < maxCol; c++) if (row[c]) used[c] = true;
  const keep = [];
  for (let c = 0; c < maxCol; c++) if (used[c]) keep.push(c);

  const dense = rows.map((row) => keep.map((c) => row[c] || { text: '' }));
  return { rows: dense, columns: keep.map(columnLetter), truncated };
}

function columnIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellValue(cellNode, { shared, styles, date1904 }) {
  const type = attr(cellNode, 't') || 'n';
  const styleIndex = Number(attr(cellNode, 's') || 0);

  if (type === 'inlineStr') return (findFirst(cellNode, 'is')?.textContent ?? '').trim();
  const vNode = childrenNamed(cellNode, 'v')[0];
  const raw = vNode?.textContent ?? '';
  if (raw === '') return '';

  switch (type) {
    case 's': {
      const idx = Number(raw);
      return (shared[idx] ?? '').trim();
    }
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    case 'e':
      return raw;
    case 'str':
      return raw.trim();
    case 'd':
      return raw;
    default: {
      const num = Number(raw);
      if (!Number.isFinite(num)) return raw;
      if (styles.isDate[styleIndex]) return serialToDate(num, date1904, styles.formats[styleIndex]);
      const format = styles.formats[styleIndex] || '';
      if (format.includes('%')) return `${trimFloat(num * 100)}%`;
      return trimFloat(num);
    }
  }
}

function trimFloat(n) {
  // Excel stores 0.1+0.2 style artefacts; 12 significant digits is plenty.
  const s = Number(n.toPrecision(12)).toString();
  return s === '-0' ? '0' : s;
}

function serialToDate(serial, date1904, format = '') {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  const hasDate = /[ymd]/i.test(format.replace(/"[^"]*"/g, '')) || !format;
  const hasTime = /[hs]/i.test(format.replace(/"[^"]*"/g, '')) || serial % 1 !== 0;
  if (hasDate && hasTime) return iso.slice(0, 19).replace('T', ' ');
  if (hasTime && !hasDate) return iso.slice(11, 19);
  return iso.slice(0, 10);
}

/* ----------------------------------------------------------------- render */

/** A header row is only assumed when row 1 is entirely text and row 2 is not. */
function detectHeader(rows) {
  if (rows.length < 2) return false;
  const first = rows[0];
  if (!first.every((c) => c.text !== '')) return false;
  if (first.some((c) => /^-?[\d.,]+$/.test(c.text))) return false;
  const second = rows[1];
  return second.some((c) => c.text !== '');
}

function renderTable(grid) {
  const header = detectHeader(grid.rows);
  const headRow = header ? grid.rows[0] : grid.columns.map((c) => ({ text: c }));
  const bodyRows = header ? grid.rows.slice(1) : grid.rows;
  const cell = (c, tag) => {
    const text = escapeHtml(c.text);
    const inner = c.href ? `<a href="${escapeHtml(c.href)}">${text}</a>` : text;
    return `<${tag}>${inner}</${tag}>`;
  };
  return [
    '<table>',
    `<thead><tr>${headRow.map((c) => cell(c, 'th')).join('')}</tr></thead>`,
    `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('')}</tbody>`,
    '</table>',
  ].join('');
}

function renderCsvBlock(grid) {
  const quote = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = grid.rows.map((r) => r.map((c) => quote(c.text)).join(','));
  return `<pre><code class="language-csv">${escapeHtml(lines.join('\n'))}</code></pre>`;
}
