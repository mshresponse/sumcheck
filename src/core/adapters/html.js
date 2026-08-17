/**
 * HTML (files, saved pages, captured tabs) -> cleaned HTML.
 *
 * With `readability` on, Mozilla's Readability (Apache-2.0) strips navigation,
 * ads and boilerplate the same way Firefox Reader View does. With it off, the
 * whole body is kept and only obvious chrome is removed.
 */

import { getReadability } from '../vendor.js';
import { parseHtmlDoc } from '../util/xml.js';
import { decodeText } from '../util/misc.js';

const CHROME_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
  'svg use', 'link', 'meta', 'form input', 'button',
  'nav', 'aside', '[role="navigation"]', '[role="banner"]',
  '[aria-hidden="true"]', '.advertisement', '.ad', '#cookie-banner',
];

export async function convertHtml(bytes, ctx, detected) {
  const text = typeof bytes === 'string' ? bytes : decodeText(bytes.buffer ?? bytes, detected?.charset);
  return convertHtmlString(text, ctx, detected?.url);
}

export async function convertHtmlString(text, ctx, sourceUrl) {
  const opts = ctx.opts;
  const doc = parseHtmlDoc(text);

  if (sourceUrl) {
    const base = doc.createElement('base');
    base.href = sourceUrl;
    doc.head?.prepend(base);
  }

  const meta = {
    title: (doc.querySelector('title')?.textContent || '').trim() || undefined,
    author: metaContent(doc, 'author') || metaContent(doc, 'article:author'),
    description: metaContent(doc, 'description') || metaContent(doc, 'og:description'),
    published: metaContent(doc, 'article:published_time') || metaContent(doc, 'date'),
    source: sourceUrl,
    kind: 'html',
  };

  const warnings = [];
  let html = null;

  if (opts.readability !== false) {
    try {
      const Readability = getReadability();
      const clone = doc.cloneNode(true);
      const article = new Readability(clone, { charThreshold: 250 }).parse();
      if (article?.content && article.content.length > 200) {
        html = article.content;
        meta.title = article.title?.trim() || meta.title;
        meta.author = article.byline?.trim() || meta.author;
        meta.siteName = article.siteName || undefined;
      } else {
        warnings.push('Article extraction found no main content — converted the full page instead.');
      }
    } catch (err) {
      warnings.push(`Article extraction failed (${err.message}); converted the full page instead.`);
    }
  }

  if (html === null) {
    for (const sel of CHROME_SELECTORS) {
      doc.querySelectorAll(sel).forEach((node) => node.remove());
    }
    const main = doc.querySelector('main, article, [role="main"]') || doc.body;
    html = main ? main.innerHTML : '';
  }

  html = absolutize(html, sourceUrl);

  if (meta.title && !/<h1[\s>]/i.test(html)) {
    html = `<h1>${meta.title.replace(/[<>&]/g, '')}</h1>\n${html}`;
  }

  return { html, warnings, meta };
}

function metaContent(doc, name) {
  const node =
    doc.querySelector(`meta[name="${name}"]`) || doc.querySelector(`meta[property="${name}"]`);
  const value = node?.getAttribute('content')?.trim();
  return value || undefined;
}

/** Relative hrefs are meaningless once the page becomes a standalone file. */
function absolutize(html, sourceUrl) {
  if (!sourceUrl) return html;
  const host = document.createElement('div');
  host.innerHTML = html;
  for (const [selector, attribute] of [
    ['a[href]', 'href'],
    ['img[src]', 'src'],
    ['source[src]', 'src'],
  ]) {
    host.querySelectorAll(selector).forEach((node) => {
      const raw = node.getAttribute(attribute);
      if (!raw || raw.startsWith('data:')) return;
      try {
        node.setAttribute(attribute, new URL(raw, sourceUrl).href);
      } catch {
        /* leave unresolvable references alone */
      }
    });
  }
  return host.innerHTML;
}
