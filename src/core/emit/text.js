/** Sanitized fragment -> plain text, with block spacing that survives grep. */

const BLOCK = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'TR',
  'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD',
]);

export function toPlainText(root) {
  const out = [];
  walk(root, out, { listDepth: 0 });
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

function walk(node, out, state) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out.push(child.nodeValue.replace(/\s+/g, ' '));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName;

    if (tag === 'BR') {
      out.push('\n');
      continue;
    }
    if (tag === 'HR') {
      out.push('\n\n----------\n\n');
      continue;
    }
    if (tag === 'IMG') {
      const alt = child.getAttribute('alt');
      if (alt) out.push(`[image: ${alt}]`);
      continue;
    }
    if (tag === 'PRE') {
      out.push('\n\n' + child.textContent.replace(/\n+$/, '') + '\n\n');
      continue;
    }
    if (tag === 'TABLE') {
      out.push('\n\n' + tableText(child) + '\n\n');
      continue;
    }
    if (tag === 'LI') {
      out.push('\n' + '  '.repeat(state.listDepth) + '- ');
      walk(child, out, { ...state, listDepth: state.listDepth + 1 });
      continue;
    }
    if (BLOCK.has(tag)) {
      out.push('\n\n');
      walk(child, out, state);
      out.push('\n\n');
      continue;
    }
    walk(child, out, state);
  }
}

function tableText(table) {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children).map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
  );
  if (!rows.length) return '';
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.min(40, Math.max(widths[i] || 0, cell.length));
    });
  }
  return rows
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i] || 0)).join('  ').trimEnd())
    .join('\n');
}
