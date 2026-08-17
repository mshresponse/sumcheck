/**
 * Structured data (.json / .jsonl / .yaml / .xml) -> HTML.
 *
 * Arrays of flat records become tables — the shape people actually want in
 * Markdown. Anything deeper becomes nested definition lists, and unparseable
 * input degrades to a fenced code block rather than failing the conversion.
 */

import { getYaml } from '../vendor.js';
import { decodeText, escapeHtml } from '../util/misc.js';

const MAX_DEPTH = 6;

export async function convertJson(bytes, ctx, detected) {
  const text = decodeText(bytes.buffer ?? bytes);
  try {
    return build(JSON.parse(text), 'json', ctx);
  } catch (err) {
    return fenced(text, 'json', [`Not valid JSON (${err.message}) — kept verbatim.`]);
  }
}

export async function convertJsonl(bytes, ctx) {
  const text = decodeText(bytes.buffer ?? bytes);
  const records = [];
  const warnings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch {
      warnings.push(`Line ${i + 1} is not valid JSON — skipped.`);
    }
  });
  if (warnings.length > 5) warnings.splice(5, warnings.length, `…and ${warnings.length - 5} more bad lines.`);
  const result = build(records, 'jsonl', ctx);
  result.warnings.push(...warnings);
  return result;
}

export async function convertYaml(bytes, ctx) {
  const text = decodeText(bytes.buffer ?? bytes);
  try {
    const docs = getYaml().loadAll(text);
    return build(docs.length === 1 ? docs[0] : docs, 'yaml', ctx);
  } catch (err) {
    return fenced(text, 'yaml', [`Not valid YAML (${err.message}) — kept verbatim.`]);
  }
}

export async function convertXml(bytes, ctx) {
  const text = decodeText(bytes.buffer ?? bytes);
  return fenced(prettyXml(text), 'xml', []);
}

function fenced(text, lang, warnings) {
  return {
    html: `<pre><code class="language-${lang}">${escapeHtml(text)}</code></pre>`,
    warnings,
    meta: { kind: lang },
  };
}

function build(value, kind, ctx) {
  const html = renderValue(value, 0, ctx.opts);
  return { html: html || '<p><em>(no data)</em></p>', warnings: [], meta: { kind } };
}

function renderValue(value, depth, opts) {
  if (value === null || value === undefined) return '<p><em>null</em></p>';
  if (Array.isArray(value)) return renderArray(value, depth, opts);
  if (typeof value === 'object') return renderObject(value, depth, opts);
  return `<p>${escapeHtml(String(value))}</p>`;
}

function renderArray(items, depth, opts) {
  if (!items.length) return '<p><em>(empty list)</em></p>';

  const table = asTable(items, opts);
  if (table) return table;

  if (items.every((v) => v === null || typeof v !== 'object')) {
    return `<ul>${items.map((v) => `<li>${escapeHtml(String(v))}</li>`).join('')}</ul>`;
  }
  if (depth >= MAX_DEPTH) return fencedText(items);
  return items
    .map((item, i) => `<h${Math.min(6, depth + 2)}>Item ${i + 1}</h${Math.min(6, depth + 2)}>${renderValue(item, depth + 1, opts)}`)
    .join('');
}

/** Uniform array of flat records -> table. */
function asTable(items, opts) {
  if (items.length < 2) return null;
  if (!items.every((v) => v && typeof v === 'object' && !Array.isArray(v))) return null;

  const columns = [];
  for (const item of items) {
    for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
  }
  if (!columns.length || columns.length > 24) return null;

  const flat = items.every((item) =>
    Object.values(item).every((v) => v === null || typeof v !== 'object')
  );
  if (!flat) return null;

  const limit = Number(opts.maxSheetRows) || 5000;
  const rows = items.slice(0, limit);
  return [
    '<table><thead><tr>',
    columns.map((c) => `<th>${escapeHtml(c)}</th>`).join(''),
    '</tr></thead><tbody>',
    rows
      .map(
        (item) =>
          `<tr>${columns
            .map((c) => `<td>${escapeHtml(item[c] === undefined || item[c] === null ? '' : String(item[c]))}</td>`)
            .join('')}</tr>`
      )
      .join(''),
    '</tbody></table>',
  ].join('');
}

function renderObject(obj, depth, opts) {
  const entries = Object.entries(obj);
  if (!entries.length) return '<p><em>(empty object)</em></p>';
  if (depth >= MAX_DEPTH) return fencedText(obj);

  const scalars = entries.filter(([, v]) => v === null || typeof v !== 'object');
  const complex = entries.filter(([, v]) => v !== null && typeof v === 'object');
  const out = [];

  if (scalars.length) {
    out.push(
      `<ul>${scalars
        .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</li>`)
        .join('')}</ul>`
    );
  }
  for (const [key, value] of complex) {
    const level = Math.min(6, depth + 2);
    out.push(`<h${level}>${escapeHtml(key)}</h${level}>`, renderValue(value, depth + 1, opts));
  }
  return out.join('');
}

function fencedText(value) {
  return `<pre><code class="language-json">${escapeHtml(JSON.stringify(value, null, 2))}</code></pre>`;
}

/**
 * Re-indent XML for a readable code block. Elements whose only content is text
 * stay on one line — `<title>News</title>`, not three lines.
 */
function prettyXml(text) {
  const tokens = text.replace(/>\s+</g, '><').trim().match(/<[^>]+>|[^<]+/g);
  if (!tokens) return text;

  const lines = [];
  let depth = 0;
  const indent = () => '  '.repeat(Math.max(0, depth));

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (!token) continue;

    if (token.startsWith('</')) {
      depth--;
      lines.push(indent() + token);
      continue;
    }
    const isOpenTag = token.startsWith('<') && !/^<[?!]/.test(token) && !token.endsWith('/>');
    if (isOpenTag) {
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      if (next && !next.startsWith('<') && after && after.startsWith('</')) {
        lines.push(indent() + token + next.trim() + after.trim());
        i += 2;
        continue;
      }
      lines.push(indent() + token);
      depth++;
      continue;
    }
    lines.push(indent() + token);
  }
  return lines.join('\n');
}
