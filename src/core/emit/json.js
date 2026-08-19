/**
 * Sanitized fragment -> a block-structured JSON document.
 *
 * This is the "machine readable" output: a flat list of typed blocks, each with
 * its plain text *and* its Markdown, which is the shape RAG pipelines, search
 * indexers and LLM ingestion jobs actually want. Page numbers are carried on
 * every block so a retrieved chunk can be cited back to the source page.
 */

import { cellText } from './text.js';

/**
 * Identifies the shape of the emitted JSON to whatever consumes it.
 *
 * Renamed with the product. Still `/v1`: the namespace changed, the structure
 * did not, and this happened before any public release, which is the only
 * moment renaming a schema id is free.
 */
export const SCHEMA_ID = 'sumcheck.document/v1';

export function toJsonDocument(root, opts, meta, turndown) {
  const blocks = [];
  let page = meta.pages ? 1 : null;

  const md = (node) => {
    try {
      return turndown.turndown(node.outerHTML).trim();
    } catch {
      return node.textContent.trim();
    }
  };
  const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
  const push = (block) => {
    if (block && (block.text || block.type === 'divider' || block.type === 'image')) {
      blocks.push({ index: blocks.length, ...(page ? { page } : {}), ...block });
    }
  };

  for (const node of Array.from(root.children)) {
    const tag = node.tagName;

    if (node.hasAttribute?.('data-smc-page')) {
      page = Number(node.getAttribute('data-smc-page')) || page;
      continue;
    }
    if (/^H[1-6]$/.test(tag)) {
      push({ type: 'heading', level: Number(tag[1]), text: text(node), markdown: md(node) });
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      push({
        type: 'list',
        ordered: tag === 'OL',
        items: listItems(node),
        text: text(node),
        markdown: md(node),
      });
      continue;
    }
    if (tag === 'TABLE') {
      push({ type: 'table', ...tableData(node), text: text(node), markdown: md(node) });
      continue;
    }
    if (tag === 'PRE') {
      const code = node.querySelector('code');
      const language = /language-([\w+-]+)/.exec(code?.className || '')?.[1] || null;
      push({ type: 'code', language, text: node.textContent.replace(/\n+$/, ''), markdown: md(node) });
      continue;
    }
    if (tag === 'BLOCKQUOTE') {
      push({
        type: 'quote',
        role: node.hasAttribute('data-smc-notes') ? 'speaker-notes' : undefined,
        text: text(node),
        markdown: md(node),
      });
      continue;
    }
    if (tag === 'HR') {
      push({ type: 'divider', text: '' });
      continue;
    }
    if (tag === 'FIGURE' || tag === 'P' || tag === 'DIV' || tag === 'SECTION') {
      const images = Array.from(node.querySelectorAll('img'));
      const bodyText = text(node);
      if (images.length && !bodyText) {
        for (const img of images) {
          push({ type: 'image', src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '', text: img.getAttribute('alt') || '' });
        }
        continue;
      }
      if (tag === 'DIV' || tag === 'SECTION') {
        // Structural wrapper: recurse so its children become top-level blocks.
        const nested = toJsonDocument(node, opts, { ...meta, pages: undefined }, turndown);
        for (const block of nested.blocks) push({ ...block, index: undefined });
        continue;
      }
      push({ type: 'paragraph', text: bodyText, markdown: md(node) });
      continue;
    }
    push({ type: 'paragraph', text: text(node), markdown: md(node) });
  }

  const review = Array.from(root.querySelectorAll('[data-smc-review]')).map((node) => ({
    message: node.getAttribute('data-smc-review'),
    context: (node.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  }));

  return {
    schema: SCHEMA_ID,
    metadata: cleanMeta(meta),
    // Everything the converter is unsure about, in one place a pipeline can gate
    // on without parsing prose.
    review,
    stats: {
      blocks: blocks.length,
      words: blocks.reduce((n, b) => n + (b.text ? b.text.split(/\s+/).filter(Boolean).length : 0), 0),
      characters: blocks.reduce((n, b) => n + (b.text?.length || 0), 0),
    },
    blocks: blocks.map((b, i) => ({ ...b, index: i })),
  };
}

function listItems(list) {
  return Array.from(list.children)
    .filter((li) => li.tagName === 'LI')
    .map((li) => {
      const nested = li.querySelector(':scope > ul, :scope > ol');
      const clone = li.cloneNode(true);
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => n.remove());
      return {
        text: clone.textContent.replace(/\s+/g, ' ').trim(),
        items: nested ? listItems(nested) : undefined,
      };
    });
}

function tableData(table) {
  const rows = Array.from(table.querySelectorAll('tr'));
  const cellsOf = (tr) =>
    Array.from(tr.children).map((c) => cellText(c));
  const headRow = table.querySelector('thead tr');
  const header = headRow ? cellsOf(headRow) : null;
  const body = rows.filter((tr) => tr !== headRow).map(cellsOf);
  const records =
    header && header.length
      ? body.map((row) => Object.fromEntries(header.map((h, i) => [h || `column_${i + 1}`, row[i] ?? ''])))
      : undefined;
  return { header, rows: body, records };
}

function cleanMeta(meta) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}
