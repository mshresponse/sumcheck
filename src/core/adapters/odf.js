/**
 * OpenDocument (.odt / .ods / .odp) -> HTML.
 *
 * LibreOffice, Google Docs exports and OpenOffice all land here. Inline
 * emphasis lives in automatic styles rather than on the run, so the style table
 * is read first and then applied while walking the content tree.
 */

import { getJSZip } from '../vendor.js';
import { parseXml, findAll, findFirst, attr, childrenNamed } from '../util/xml.js';
import { escapeHtml, bytesToDataUrl, imageMimeFor } from '../util/misc.js';

export async function convertOdf(bytes, ctx, detected) {
  const zip = detected?.zip || (await getJSZip().loadAsync(bytes));
  const kind = detected?.kind || 'odt';
  const opts = ctx.opts;
  ctx.progress(0.1, 'Reading document');

  const contentFile = zip.file('content.xml');
  if (!contentFile) throw new Error('This OpenDocument file has no content.xml.');
  const content = parseXml(await contentFile.async('string'));
  const styles = readStyles(content, await optionalXml(zip, 'styles.xml'));
  const meta = await readMeta(zip);

  const state = { zip, styles, opts, images: new Map() };
  let html;
  if (kind === 'ods') html = renderSpreadsheet(content, state);
  else if (kind === 'odp') html = await renderPresentation(content, state);
  else html = await renderText(content, state);

  ctx.progress(1, 'Done');
  return { html, warnings: [], meta: { ...meta, kind } };
}

async function optionalXml(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  try {
    return parseXml(await file.async('string'));
  } catch {
    return null;
  }
}

async function readMeta(zip) {
  const doc = await optionalXml(zip, 'meta.xml');
  if (!doc) return {};
  return {
    title: findFirst(doc, 'dc:title')?.textContent?.trim() || undefined,
    author: findFirst(doc, 'meta:initial-creator')?.textContent?.trim() || undefined,
    created: findFirst(doc, 'meta:creation-date')?.textContent?.trim() || undefined,
  };
}

function readStyles(...docs) {
  const map = new Map();
  for (const doc of docs) {
    if (!doc) continue;
    for (const style of findAll(doc, 'style:style')) {
      const name = attr(style, 'style:name');
      if (!name) continue;
      const text = findFirst(style, 'style:text-properties');
      map.set(name, {
        bold: /bold|[6-9]00/.test(attr(text, 'fo:font-weight') || ''),
        italic: /italic|oblique/.test(attr(text, 'fo:font-style') || ''),
        underline: (attr(text, 'style:text-underline-style') || 'none') !== 'none',
        strike: (attr(text, 'style:text-line-through-style') || 'none') !== 'none',
        mono: /mono|courier/i.test(attr(text, 'style:font-name') || ''),
      });
    }
  }
  return map;
}

/* ------------------------------------------------------------------- text */

async function renderText(content, state) {
  const body = findFirst(content, 'office:text');
  if (!body) return '';
  return (await renderFlow(body, state)).join('\n');
}

async function renderFlow(node, state) {
  const out = [];
  for (const child of Array.from(node.children)) {
    const html = await renderBlock(child, state);
    if (html) out.push(html);
  }
  return out;
}

async function renderBlock(node, state) {
  switch (node.localName) {
    case 'h': {
      const level = Math.min(6, Math.max(1, Number(attr(node, 'text:outline-level') || 1)));
      const text = inlineHtml(node, state);
      return text ? `<h${level}>${text}</h${level}>` : '';
    }
    case 'p': {
      const inner = await paragraphHtml(node, state);
      return inner ? `<p>${inner}</p>` : '';
    }
    case 'list':
      return await renderList(node, state);
    case 'table':
      return renderOdfTable(node, state);
    case 'section': {
      const parts = await renderFlow(node, state);
      return parts.join('\n');
    }
    case 'frame': {
      const img = await imageFromFrame(node, state);
      return img ? `<p>${img}</p>` : '';
    }
    default:
      return '';
  }
}

async function paragraphHtml(node, state) {
  let html = inlineHtml(node, state);
  for (const frame of findAll(node, 'draw:frame')) {
    const img = await imageFromFrame(frame, state);
    if (img) html += img;
  }
  return html;
}

async function renderList(node, state, ordered = null) {
  const isOrdered =
    ordered ?? /number|alpha|roman/i.test(attr(node, 'text:style-name') || '') ;
  const tag = isOrdered ? 'ol' : 'ul';
  const items = [];
  for (const item of childrenNamed(node, 'text:list-item')) {
    const parts = [];
    for (const child of Array.from(item.children)) {
      if (child.localName === 'list') parts.push(await renderList(child, state, isOrdered));
      else if (child.localName === 'p' || child.localName === 'h') {
        const inner = await paragraphHtml(child, state);
        if (inner) parts.push(inner);
      }
    }
    items.push(`<li>${parts.join('')}</li>`);
  }
  return items.length ? `<${tag}>${items.join('')}</${tag}>` : '';
}

function renderOdfTable(node, state) {
  const rows = [];
  for (const row of findAll(node, 'table:table-row')) {
    const cells = [];
    for (const cell of childrenNamed(row, 'table:table-cell')) {
      const repeat = Math.min(64, Number(attr(cell, 'table:number-columns-repeated') || 1));
      const text = childrenNamed(cell, 'text:p')
        .map((p) => inlineHtml(p, state))
        .join('<br>');
      for (let i = 0; i < repeat; i++) cells.push(text);
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    rows.push(cells);
  }
  const populated = rows.filter((r) => r.some(Boolean));
  if (!populated.length) return '';
  const [head, ...body] = populated;
  return [
    '<table><thead><tr>',
    head.map((c) => `<th>${c}</th>`).join(''),
    '</tr></thead><tbody>',
    body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join(''),
    '</tbody></table>',
  ].join('');
}

/* ------------------------------------------------------------ spreadsheet */

function renderSpreadsheet(content, state) {
  const out = [];
  for (const table of findAll(content, 'table:table')) {
    const name = attr(table, 'table:name') || 'Sheet';
    const rows = [];
    for (const row of findAll(table, 'table:table-row')) {
      const repeatRow = Math.min(2000, Number(attr(row, 'table:number-rows-repeated') || 1));
      const cells = [];
      for (const cell of childrenNamed(row, 'table:table-cell')) {
        const repeat = Math.min(256, Number(attr(cell, 'table:number-columns-repeated') || 1));
        const value = cellText(cell, state);
        for (let i = 0; i < repeat; i++) cells.push(value);
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (!cells.length && repeatRow > 1) continue; // repeated blank filler rows
      for (let i = 0; i < repeatRow && rows.length < (state.opts.maxSheetRows || 5000); i++) {
        rows.push(cells);
      }
    }
    while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
    if (!rows.length) continue;
    const [head, ...body] = rows;
    out.push(`<h2>${escapeHtml(name)}</h2>`);
    out.push(
      [
        '<table><thead><tr>',
        head.map((c) => `<th>${c}</th>`).join(''),
        '</tr></thead><tbody>',
        body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join(''),
        '</tbody></table>',
      ].join('')
    );
  }
  return out.join('\n');
}

function cellText(cell, state) {
  const type = attr(cell, 'office:value-type');
  if (type === 'date') return escapeHtml(attr(cell, 'office:date-value') || '');
  if (type === 'time') return escapeHtml(attr(cell, 'office:time-value') || '');
  if (type === 'boolean') return attr(cell, 'office:boolean-value') === 'true' ? 'TRUE' : 'FALSE';
  if (type === 'float' || type === 'currency' || type === 'percentage') {
    const raw = attr(cell, 'office:value');
    const shown = childrenNamed(cell, 'text:p').map((p) => p.textContent).join('');
    return escapeHtml(shown || raw || '');
  }
  return childrenNamed(cell, 'text:p')
    .map((p) => inlineHtml(p, state))
    .join('<br>');
}

/* ------------------------------------------------------------ presentation */

async function renderPresentation(content, state) {
  const out = [];
  const pages = findAll(content, 'draw:page');
  let index = 0;
  for (const page of pages) {
    index++;
    const name = attr(page, 'draw:name') || `Slide ${index}`;
    out.push(`<h2 data-smc-slide="${index}">${escapeHtml(name)}</h2>`);
    for (const frame of findAll(page, 'draw:frame')) {
      const box = findFirst(frame, 'draw:text-box');
      if (box) {
        for (const child of Array.from(box.children)) {
          const html = await renderBlock(child, state);
          if (html) out.push(html);
        }
      } else {
        const img = await imageFromFrame(frame, state);
        if (img) out.push(`<p>${img}</p>`);
      }
    }
  }
  return out.join('\n');
}

/* ----------------------------------------------------------------- inline */

function inlineHtml(node, state) {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out += escapeHtml(child.nodeValue);
      continue;
    }
    if (child.nodeType !== 1) continue;
    switch (child.localName) {
      case 'span': {
        const style = state.styles.get(attr(child, 'text:style-name')) || {};
        let inner = inlineHtml(child, state);
        if (!inner) break;
        if (style.mono) inner = `<code>${inner}</code>`;
        if (style.bold) inner = `<strong>${inner}</strong>`;
        if (style.italic) inner = `<em>${inner}</em>`;
        if (style.strike) inner = `<s>${inner}</s>`;
        if (style.underline) inner = `<u>${inner}</u>`;
        out += inner;
        break;
      }
      case 'a': {
        const href = attr(child, 'xlink:href') || '#';
        out += `<a href="${escapeHtml(href)}">${inlineHtml(child, state)}</a>`;
        break;
      }
      case 's': {
        const count = Number(attr(child, 'text:c') || 1);
        out += ' '.repeat(Math.min(count, 40));
        break;
      }
      case 'tab':
        out += ' ';
        break;
      case 'line-break':
        out += '<br>';
        break;
      case 'note': {
        const body = findFirst(child, 'text:note-body');
        if (body) out += ` <em>(${inlineHtml(body, state).replace(/<[^>]+>/g, '')})</em>`;
        break;
      }
      case 'frame':
        break; // handled by the block renderer so images stay outside <p> runs
      default:
        out += inlineHtml(child, state);
    }
  }
  return out;
}

async function imageFromFrame(frame, state) {
  if (state.opts.imageMode === 'strip') return '';
  const image = findFirst(frame, 'draw:image');
  const href = attr(image, 'xlink:href');
  if (!href) return '';
  const alt = findFirst(frame, 'svg:title')?.textContent || attr(frame, 'draw:name') || '';
  const path = href.replace(/^\.\//, '');
  const file = state.zip.file(path);
  if (!file) return '';
  const data = await file.async('uint8array');
  if (data.byteLength > (state.opts.maxImageBytes || Infinity)) return '';
  const src = bytesToDataUrl(data, imageMimeFor(path));
  return `<img src="${src}" alt="${escapeHtml(alt)}">`;
}
