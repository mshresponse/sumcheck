/**
 * HTML -> Markdown, via Turndown (MIT) + the GFM plugin (MIT).
 *
 * Turndown handles the mechanical translation; the rules below carry the
 * structure our adapters encode in data-smc-* attributes (page breaks, slide
 * numbers, speaker notes) and fix the places where plain CommonMark loses
 * information.
 */

import { getTurndown, getTurndownGfm } from '../vendor.js';

export function createTurndown(opts) {
  const TurndownService = getTurndown();
  const service = new TurndownService({
    headingStyle: opts.headingStyle || 'atx',
    hr: '---',
    bulletListMarker: opts.bulletMarker || '-',
    codeBlockStyle: opts.codeBlockStyle || 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: opts.linkStyle === 'referenced' ? 'referenced' : 'inlined',
    linkReferenceStyle: 'full',
    preformattedCode: true,
    blankReplacement: (content, node) => (node.isBlock ? '\n\n' : ''),
  });

  if (opts.mdFlavor !== 'commonmark') {
    const gfm = getTurndownGfm();
    service.use([gfm.tables, gfm.strikethrough, gfm.taskListItems]);
  }

  // Markdown has no syntax for these, and dropping them silently loses meaning.
  service.keep(['sub', 'sup', 'u']);

  service.addRule('sumcheckPageMarker', {
    filter: (node) => node.nodeName === 'HR' && node.hasAttribute('data-smc-page'),
    replacement: (content, node) => {
      if (opts.pageMarkers === 'none') return '\n\n';
      if (opts.pageMarkers === 'rule') return '\n\n---\n\n';
      return `\n\n<!-- page ${node.getAttribute('data-smc-page')} -->\n\n`;
    },
  });

  /**
   * A line break inside a table cell stays literal markup.
   *
   * Turndown's default for `<br>` is a newline, and a newline inside a GFM
   * table cell ends the row — one cell carrying a definition list would split
   * the table into fragments of prose. `<br>` is the only break GFM tables
   * accept, and every renderer that understands the table understands it.
   */
  service.addRule('sumcheckCellBreak', {
    filter: (node) => node.nodeName === 'BR' && Boolean(node.closest?.('td, th')),
    replacement: () => '<br>',
  });

  // Review flags travel as empty spans so they survive sanitizing; in Markdown
  // they become comments, which are visible to a human reading the file and
  // ignorable by a parser.
  service.addRule('sumcheckReview', {
    filter: (node) => node.nodeName === 'SPAN' && node.hasAttribute('data-smc-review'),
    replacement: (content, node) => ` <!-- SUMCHECK: ${node.getAttribute('data-smc-review')} -->`,
  });

  /**
   * Turndown escapes "_" and "." wherever it finds them, which is right for
   * prose and wrong inside a URL — it turns a working link into a dead one.
   */
  service.addRule('sumcheckLink', {
    filter: (node) => node.nodeName === 'A' && node.getAttribute('href'),
    replacement: (content, node) => {
      const href = node.getAttribute('href');
      const text = unescapeUrlish(content).trim();
      if (!text) return '';
      const title = node.getAttribute('title');
      if (!title && (text === href || `${text}/` === href || href === `https://${text}` || href === `http://${text}`)) {
        return `<${href}>`;
      }
      return `[${text}](${href}${title ? ` "${title.replace(/"/g, '')}"` : ''})`;
    },
  });

  service.addRule('sumcheckHighlight', {
    filter: 'mark',
    replacement: (content) => (content ? `==${content}==` : ''),
  });

  service.addRule('sumcheckFigure', {
    filter: 'figure',
    replacement: (content) => `\n\n${content.trim()}\n\n`,
  });

  service.addRule('sumcheckCaption', {
    filter: ['figcaption', 'caption'],
    replacement: (content) => (content.trim() ? `\n\n_${content.trim()}_\n\n` : ''),
  });

  // An <img> with no src (stripped by the image policy) should vanish, not
  // leave `![]()` behind.
  service.addRule('sumcheckImage', {
    filter: 'img',
    replacement: (content, node) => {
      const src = node.getAttribute('src') || '';
      if (!src) return '';
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      const title = node.getAttribute('title');
      return `![${alt}](${src}${title ? ` "${title.replace(/"/g, '')}"` : ''})`;
    },
  });

  // Turndown pads list markers to four columns ("-   item"). Every other tool
  // in the ecosystem writes "- item", and diffs against those files are
  // otherwise noise.
  service.addRule('sumcheckListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentNode;
      let prefix = `${options.bulletListMarker} `;
      if (parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const indent = ' '.repeat(prefix.length);
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .replace(/\n/gm, `\n${indent}`);
      return prefix + body + (node.nextSibling ? '\n' : '');
    },
  });

  service.addRule('sumcheckEmptyLink', {
    filter: (node) => node.nodeName === 'A' && !node.getAttribute('href'),
    replacement: (content) => content,
  });

  return service;
}

export function toMarkdown(html, opts, meta = {}) {
  const service = createTurndown(opts);
  let body = service.turndown(html);

  body = body
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\|.*\|$/gm, unescapeTableRow)
    .trim();

  if (opts.wrap > 0) body = hardWrap(body, opts.wrap);

  const front = opts.frontMatter ? frontMatter(meta) : '';
  return `${front}${body}\n`;
}

/** Serialize metadata as YAML front matter, skipping empty values. */
export function frontMatter(meta) {
  const fields = [
    ['title', meta.title],
    ['source', meta.source],
    ['author', meta.author],
    ['created', meta.created],
    ['converted', meta.converted],
    ['source_format', meta.kind],
    ['pages', meta.pages],
    ['slides', meta.slides],
    ['sheets', meta.sheets],
    ['chapters', meta.chapters],
    ['language', meta.language],
    ['producer', meta.producer],
    ['creator', meta.creator],
    ['ocr', meta.ocr || (meta.ocrPages ? true : undefined)],
    ['ocr_pages', meta.ocrPages || undefined],
    ['ocr_dpi', meta.ocrDpi],
    ['ocr_confidence_mean', meta.ocrConfidenceMean],
    ['ocr_confidence_min', meta.ocrConfidenceMin],
    ['ocr_flagged_fields', meta.ocrFlaggedFields],
    ['ocr_unreadable_regions', meta.ocrUnreadableRegions],
    /**
     * Columnar rows that reached the output as prose because they resolved
     * into no grid. Without this a reader cannot tell a document that never
     * had a table from one whose table was lost — the text looks the same
     * either way, and only the second case needs checking.
     */
    ['table_fallback', meta.tablesUnresolved || undefined],
    ['needs_review', meta.needsReview],
    ['review_flags', meta.reviewFlags],
    ['generator', meta.generator],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!fields.length) return '';
  const lines = fields.map(([key, value]) => `${key}: ${yamlScalar(value)}`);

  // The words the engine was least sure about, so a reader knows exactly which
  // characters to check against the original rather than trusting all of them.
  if (meta.ocrLowConfidence?.length) {
    lines.push('ocr_low_confidence:');
    for (const word of meta.ocrLowConfidence) {
      lines.push(
        `  - text: ${yamlScalar(word.text)}`,
        `    confidence: ${word.confidence}`,
        `    page: ${word.page}`
      );
    }
  }
  return `---\n${lines.join('\n')}\n---\n\n`;
}

/**
 * Turndown escapes anything that could start a block ("-4%" -> "\-4%"). Inside
 * a table cell nothing can start a block, so the backslashes are pure noise.
 */
function unescapeTableRow(row) {
  return row.replace(/\\([-+*_#.>[\]`])/g, '$1');
}

/** Undo Turndown's escaping inside link text that is itself a URL or domain. */
function unescapeUrlish(text) {
  const plain = text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');
  return /^(https?:\/\/|www\.|[\w-]+\.[a-z]{2,}(\/|$))/i.test(plain) ? plain : text;
}

function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value).replace(/\r?\n/g, ' ').trim();
  if (/^[\w][\w .,:/@+-]*$/.test(text) && !/: /.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Wrap prose at a column, leaving code fences, tables and links intact. */
function hardWrap(markdown, width) {
  const out = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence || line.length <= width || /^\s*\|/.test(line) || /^\s{4,}\S/.test(line)) {
      out.push(line);
      continue;
    }
    const indent = /^(\s*(?:[-*+]|\d+\.)?\s*)/.exec(line)[1];
    const words = line.slice(indent.length).split(/\s+/);
    let current = indent;
    for (const word of words) {
      if (current.trim() && current.length + word.length + 1 > width) {
        out.push(current.replace(/\s+$/, ''));
        current = ' '.repeat(indent.length) + word;
      } else current += (current.trim() ? ' ' : '') + word;
    }
    if (current.trim()) out.push(current);
  }
  return out.join('\n');
}
