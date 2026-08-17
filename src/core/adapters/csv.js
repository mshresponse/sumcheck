/** CSV / TSV / pipe-delimited text -> an HTML table. */

import { getPapa } from '../vendor.js';
import { decodeText, escapeHtml, extOf } from '../util/misc.js';

const DELIMITERS = { csv: ',', tsv: '\t', psv: '|' };

export async function convertCsv(bytes, ctx, detected) {
  const text = decodeText(bytes.buffer ?? bytes);
  const Papa = getPapa();
  const ext = detected?.ext || extOf(ctx.name);

  const parsed = Papa.parse(text.trim(), {
    delimiter: DELIMITERS[ext] || '', // '' lets Papa auto-detect
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    header: false,
  });

  const warnings = [];
  for (const err of (parsed.errors || []).slice(0, 5)) {
    warnings.push(`Row ${err.row ?? '?'}: ${err.message}`);
  }
  if ((parsed.errors || []).length > 5) {
    warnings.push(`…and ${parsed.errors.length - 5} more parse warnings.`);
  }

  let rows = parsed.data.filter((row) => row.some((cell) => String(cell).trim() !== ''));
  const limit = Number(ctx.opts.maxSheetRows) || 5000;
  if (rows.length > limit) {
    warnings.push(`Truncated to ${limit} of ${rows.length} rows (raise the limit in Settings).`);
    rows = rows.slice(0, limit);
  }
  if (!rows.length) return { html: '<p><em>(empty file)</em></p>', warnings, meta: { kind: 'csv' } };

  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim());

  const header = pad(rows[0]);
  const headerLooksReal =
    rows.length > 1 && header.every((c) => c !== '') && !header.some((c) => /^-?[\d.,]+$/.test(c));
  const headRow = headerLooksReal ? header : header.map((_, i) => `Column ${i + 1}`);
  const bodyRows = headerLooksReal ? rows.slice(1) : rows;

  const html = [
    '<table><thead><tr>',
    headRow.map((c) => `<th>${escapeHtml(c)}</th>`).join(''),
    '</tr></thead><tbody>',
    bodyRows
      .map((r) => `<tr>${pad(r).map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
      .join(''),
    '</tbody></table>',
  ].join('');

  return {
    html,
    warnings,
    meta: {
      kind: 'csv',
      rows: bodyRows.length,
      columns: width,
      delimiter: parsed.meta?.delimiter,
    },
  };
}
