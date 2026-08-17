/**
 * PowerPoint (.pptx/.pptm/.potx) -> HTML.
 *
 * Slides are a shape tree, not a document flow, so the output is normalized to
 * "one H2 per slide, then its shapes in z-order": title placeholder first,
 * then body text as lists, then tables, pictures and finally speaker notes.
 */

import { getJSZip } from '../vendor.js';
import { parseXml, findAll, findFirst, attr, childrenNamed } from '../util/xml.js';
import { escapeHtml, bytesToDataUrl, imageMimeFor } from '../util/misc.js';
import { buildNestedList } from '../util/lists.js';

const SKIP_PLACEHOLDERS = new Set(['ftr', 'sldNum', 'dt']);

export async function convertPptx(bytes, ctx, detected) {
  const zip = detected?.zip || (await getJSZip().loadAsync(bytes));
  const opts = ctx.opts;

  const presentation = await readXml(zip, 'ppt/presentation.xml');
  const presRels = await readRels(zip, 'ppt/_rels/presentation.xml.rels');
  const slidePaths = findAll(presentation, 'sldId')
    .map((node) => presRels[attr(node, 'r:id') || attr(node, 'id')]?.target)
    .map((target) => resolvePart('ppt/', target))
    .filter((p) => p && zip.file(p));

  const out = [];
  const warnings = [];
  const title = await deckTitle(zip);
  if (title) out.push(`<h1>${escapeHtml(title)}</h1>`);

  for (let i = 0; i < slidePaths.length; i++) {
    ctx.progress((i + 1) / (slidePaths.length + 1), `Slide ${i + 1} of ${slidePaths.length}`);
    const path = slidePaths[i];
    try {
      const slideXml = await readXml(zip, path);
      const rels = await readRels(zip, path.replace(/([^/]+)$/, '_rels/$1.rels'));
      const parsed = await renderSlide(slideXml, { zip, rels, opts, index: i + 1 });
      out.push(parsed);

      if (opts.includeSpeakerNotes !== false) {
        const notesPath = Object.values(rels).find((r) => /notesSlide\d+\.xml$/.test(r.target || ''));
        if (notesPath) {
          const notes = await readNotes(zip, resolvePart(path, notesPath.target));
          if (notes) out.push(`<blockquote data-smc-notes="1"><p><strong>Speaker notes</strong></p>${notes}</blockquote>`);
        }
      }
    } catch (err) {
      warnings.push(`Slide ${i + 1} could not be read: ${err.message}`);
    }
  }

  if (!slidePaths.length) warnings.push('No slides were found in this presentation.');

  return {
    html: out.join('\n'),
    warnings,
    meta: { kind: 'pptx', slides: slidePaths.length, title },
  };
}

async function deckTitle(zip) {
  const file = zip.file('docProps/core.xml');
  if (!file) return null;
  try {
    const doc = parseXml(await file.async('string'));
    return findFirst(doc, 'dc:title')?.textContent?.trim() || null;
  } catch {
    return null;
  }
}

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

function resolvePart(baseDirOrFile, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  const baseDir = baseDirOrFile.endsWith('/')
    ? baseDirOrFile
    : baseDirOrFile.replace(/[^/]+$/, '');
  const stack = baseDir.split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (part === '..') stack.pop();
    else if (part !== '.' && part !== '') stack.push(part);
  }
  return stack.join('/');
}

/* ----------------------------------------------------------------- slides */

async function renderSlide(slideXml, { zip, rels, opts, index }) {
  const tree = findFirst(slideXml, 'p:spTree') || slideXml.documentElement;
  const shapes = [];
  collectShapes(tree, shapes);

  let heading = null;
  const body = [];

  for (const shape of shapes) {
    if (shape.type === 'text') {
      if (SKIP_PLACEHOLDERS.has(shape.placeholder)) continue;
      if (!heading && (shape.placeholder === 'title' || shape.placeholder === 'ctrTitle')) {
        heading = shape.paragraphs.map((p) => p.text).join(' ').trim();
        continue;
      }
      body.push(renderParagraphs(shape.paragraphs));
    } else if (shape.type === 'table') {
      body.push(renderTable(shape.rows));
    } else if (shape.type === 'image' && opts.imageMode !== 'strip') {
      const img = await imageHtml(zip, rels, shape, opts);
      if (img) body.push(img);
    }
  }

  const title = heading ? `${escapeHtml(heading)}` : `Slide ${index}`;
  return [`<h2 data-smc-slide="${index}">${title}</h2>`, ...body.filter(Boolean)].join('\n');
}

function collectShapes(node, out) {
  for (const child of Array.from(node.children)) {
    const name = child.localName;
    if (name === 'sp') {
      const txBody = findFirst(child, 'p:txBody') || findFirst(child, 'txBody');
      const ph = findFirst(child, 'p:ph');
      const paragraphs = txBody ? readParagraphs(txBody) : [];
      if (paragraphs.some((p) => p.text.trim()))
        out.push({ type: 'text', placeholder: attr(ph, 'type') || '', paragraphs });
    } else if (name === 'graphicFrame') {
      const tbl = findFirst(child, 'a:tbl');
      if (tbl) out.push({ type: 'table', rows: readTable(tbl) });
    } else if (name === 'pic') {
      const blip = findFirst(child, 'a:blip');
      const embed = attr(blip, 'r:embed') || attr(blip, 'embed');
      const descr = attr(findFirst(child, 'p:cNvPr'), 'descr') || attr(findFirst(child, 'p:cNvPr'), 'name');
      if (embed) out.push({ type: 'image', embed, alt: descr || '' });
    } else if (name === 'grpSp') {
      collectShapes(child, out);
    }
  }
}

function readParagraphs(txBody) {
  return childrenNamed(txBody, 'a:p').map((p) => {
    const pPr = findFirst(p, 'a:pPr');
    const level = Number(attr(pPr, 'lvl') || 0);
    const bullet = !findFirst(p, 'a:buNone');
    let text = '';
    const segments = [];
    for (const node of Array.from(p.children)) {
      if (node.localName === 'r') {
        const t = findFirst(node, 'a:t')?.textContent ?? '';
        const rPr = findFirst(node, 'a:rPr');
        segments.push({
          text: t,
          bold: attr(rPr, 'b') === '1',
          italic: attr(rPr, 'i') === '1',
        });
        text += t;
      } else if (node.localName === 'br') {
        segments.push({ text: '\n' });
        text += '\n';
      } else if (node.localName === 'fld') {
        const t = findFirst(node, 'a:t')?.textContent ?? '';
        segments.push({ text: t });
        text += t;
      }
    }
    return { level, bullet, text, segments };
  });
}

function renderParagraphs(paragraphs) {
  const out = [];
  let items = [];
  const flush = () => {
    if (items.length) {
      out.push(buildNestedList(items, false));
      items = [];
    }
  };
  for (const para of paragraphs) {
    const html = inline(para.segments);
    if (!html) continue;
    if (para.bullet) {
      items.push({ level: para.level, html });
    } else {
      flush();
      out.push(`<p>${html}</p>`);
    }
  }
  flush();
  return out.join('');
}

function inline(segments) {
  return segments
    .map((s) => {
      if (s.text === '\n') return '<br>';
      let t = escapeHtml(s.text);
      if (!t) return '';
      if (s.bold) t = `<strong>${t}</strong>`;
      if (s.italic) t = `<em>${t}</em>`;
      return t;
    })
    .join('')
    .trim();
}

function readTable(tbl) {
  return findAll(tbl, 'a:tr').map((tr) =>
    childrenNamed(tr, 'a:tc').map((tc) => {
      const txBody = findFirst(tc, 'a:txBody');
      return txBody
        ? readParagraphs(txBody)
            .map((p) => p.text)
            .join(' ')
            .trim()
        : '';
    })
  );
}

function renderTable(rows) {
  if (!rows.length) return '';
  const [head, ...body] = rows;
  return [
    '<table><thead><tr>',
    head.map((c) => `<th>${escapeHtml(c)}</th>`).join(''),
    '</tr></thead><tbody>',
    body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join(''),
    '</tbody></table>',
  ].join('');
}

async function imageHtml(zip, rels, shape, opts) {
  const rel = rels[shape.embed];
  if (!rel?.target) return '';
  const path = resolvePart('ppt/slides/', rel.target);
  const file = zip.file(path);
  if (!file) return '';
  const data = await file.async('uint8array');
  if (data.byteLength > (opts.maxImageBytes || Infinity)) return '';
  const src = bytesToDataUrl(data, imageMimeFor(path));
  return `<p><img src="${src}" alt="${escapeHtml(shape.alt || '')}"></p>`;
}

async function readNotes(zip, path) {
  const file = zip.file(path);
  if (!file) return '';
  const doc = parseXml(await file.async('string'));
  const bodies = findAll(doc, 'p:txBody');
  const parts = [];
  for (const body of bodies) {
    const paragraphs = readParagraphs(body).filter((p) => p.text.trim() && !/^\d+$/.test(p.text.trim()));
    if (paragraphs.length) parts.push(paragraphs.map((p) => `<p>${escapeHtml(p.text)}</p>`).join(''));
  }
  return parts.join('');
}
