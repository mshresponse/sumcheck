/**
 * Every adapter produces an HTML string, and every HTML string passes through
 * here before it is rendered, previewed or converted.
 *
 * This matters even though the extension is offline-only: a converted file is
 * attacker-controlled input (a PDF or .docx from an unknown sender), and the
 * preview pane renders it inside a privileged extension page.
 */

import { getDOMPurify } from './vendor.js';

const CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'span', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small',
    'sub', 'sup', 'code', 'pre', 'kbd', 'samp', 'var',
    'a', 'img', 'figure', 'figcaption',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'blockquote', 'q', 'cite',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
    'abbr', 'time', 'address',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'type',
    'datetime', 'cite', 'id', 'lang', 'dir', 'align', 'width', 'height',
    // Carries the code language ("language-python"), which is what turns a
    // <pre><code> into a tagged fence rather than a bare one.
    'class',
  ],
  ALLOW_DATA_ATTR: true, // we carry structure hints in data-smc-*
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
  KEEP_CONTENT: true,
};

let hooked = false;

function ensureHooks(purify) {
  if (hooked) return;
  hooked = true;
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

/** @returns {string} sanitized HTML */
export function sanitizeHtml(html) {
  const purify = getDOMPurify();
  ensureHooks(purify);
  return purify.sanitize(String(html ?? ''), CONFIG);
}

