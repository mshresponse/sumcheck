/** Plain text, Markdown and source files. */

import { getMarked } from '../vendor.js';
import { decodeText, escapeHtml, extOf } from '../util/misc.js';

const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', sql: 'sql', css: 'css',
  ini: 'ini', conf: 'ini', toml: 'toml', swift: 'swift', kt: 'kotlin', r: 'r',
};

export async function convertText(bytes, ctx, detected) {
  const text = decodeText(bytes.buffer ?? bytes);
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const html = paragraphs
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return { html, warnings: [], meta: { kind: detected?.kind || 'text' } };
}

export async function convertMarkdown(bytes, ctx, detected) {
  const source = decodeText(bytes.buffer ?? bytes);
  const { body, frontMatter } = splitFrontMatter(source);
  const marked = getMarked();
  const html = marked.parse(body, { async: false, gfm: true, breaks: false });
  return {
    html,
    // Round-tripping Markdown through HTML loses reference links, footnotes and
    // raw HTML, so the source is handed straight through for .md output.
    nativeMarkdown: body,
    warnings: [],
    meta: { kind: 'markdown', ...frontMatter },
  };
}

export async function convertCode(bytes, ctx, detected) {
  const text = decodeText(bytes.buffer ?? bytes);
  const lang = LANG_BY_EXT[detected?.ext || ''] || extOf(ctx.name) || '';
  const html = `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(text)}</code></pre>`;
  return { html, warnings: [], meta: { kind: 'code', language: lang } };
}

/** Recognizes the common `---\nkey: value\n---` header without a YAML parse. */
function splitFrontMatter(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { body: source, frontMatter: {} };
  const frontMatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) frontMatter[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return { body: source.slice(m[0].length), frontMatter };
}
