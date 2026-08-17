/**
 * Jupyter notebooks (.ipynb) -> Markdown.
 *
 * Markdown cells pass through untouched, code cells become fenced blocks in the
 * kernel's language, and outputs are kept as text or embedded images so the
 * converted file still shows what the notebook produced.
 */

import { getMarked } from '../vendor.js';
import { decodeText } from '../util/misc.js';

export async function convertIpynb(bytes, ctx) {
  const text = decodeText(bytes.buffer ?? bytes);
  let notebook;
  try {
    notebook = JSON.parse(text);
  } catch (err) {
    throw new Error(`This .ipynb file is not valid JSON (${err.message}).`);
  }

  const language =
    notebook.metadata?.language_info?.name ||
    notebook.metadata?.kernelspec?.language ||
    'python';
  const opts = ctx.opts;
  const md = [];
  const warnings = [];
  const cells = notebook.cells || notebook.worksheets?.[0]?.cells || [];

  for (const cell of cells) {
    const source = joinSource(cell.source ?? cell.input);
    if (cell.cell_type === 'markdown') {
      if (source.trim()) md.push(source.trim());
    } else if (cell.cell_type === 'code') {
      if (source.trim()) md.push(fence(source.trimEnd(), language));
      for (const output of cell.outputs || []) {
        const rendered = renderOutput(output, opts, warnings);
        if (rendered) md.push(rendered);
      }
    } else if (cell.cell_type === 'raw' && source.trim()) {
      md.push(fence(source.trimEnd(), ''));
    }
  }

  const markdown = md.join('\n\n');
  return {
    html: getMarked().parse(markdown, { async: false, gfm: true }),
    nativeMarkdown: markdown,
    warnings,
    meta: {
      kind: 'ipynb',
      language,
      cells: cells.length,
      title: notebook.metadata?.title,
    },
  };
}

const joinSource = (source) => (Array.isArray(source) ? source.join('') : String(source ?? ''));

function fence(code, lang) {
  const ticks = '`'.repeat(Math.max(3, longestTickRun(code) + 1));
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

function longestTickRun(text) {
  let max = 0;
  for (const m of text.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  return max;
}

function renderOutput(output, opts, warnings) {
  const type = output.output_type;
  if (type === 'stream') {
    const text = joinSource(output.text).trimEnd();
    return text ? fence(text, 'text') : '';
  }
  if (type === 'error') {
    const trace = (output.traceback || []).join('\n').replace(/\[[0-9;]*m/g, '');
    return fence(trace || `${output.ename}: ${output.evalue}`, 'text');
  }
  if (type === 'execute_result' || type === 'display_data') {
    const data = output.data || {};
    if (data['image/png'] && opts.imageMode !== 'strip') {
      const b64 = joinSource(data['image/png']).replace(/\s/g, '');
      return `![output](data:image/png;base64,${b64})`;
    }
    if (data['image/jpeg'] && opts.imageMode !== 'strip') {
      const b64 = joinSource(data['image/jpeg']).replace(/\s/g, '');
      return `![output](data:image/jpeg;base64,${b64})`;
    }
    if (data['text/markdown']) return joinSource(data['text/markdown']).trim();
    if (data['text/html']) {
      warnings.push('An HTML output (often a DataFrame) was kept as raw HTML.');
      return joinSource(data['text/html']).trim();
    }
    if (data['text/plain']) return fence(joinSource(data['text/plain']).trimEnd(), 'text');
  }
  return '';
}
