/**
 * EPUB (2 and 3) -> HTML.
 *
 * An EPUB is a zip of XHTML documents plus a manifest. The spine defines
 * reading order, which is the only order worth exporting; the navigation
 * document is skipped because a table of contents converts to a wall of links.
 */

import { getJSZip } from '../vendor.js';
import { parseXml, parseHtmlDoc, findAll, findFirst, attr } from '../util/xml.js';
import { escapeHtml, bytesToDataUrl, imageMimeFor, resolveArchivePath } from '../util/misc.js';

export async function convertEpub(bytes, ctx, detected) {
  const zip = detected?.zip || (await getJSZip().loadAsync(bytes));
  const opts = ctx.opts;
  ctx.progress(0.05, 'Reading container');

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Not a valid EPUB: META-INF/container.xml is missing.');
  const container = parseXml(await containerFile.async('string'));
  const opfPath = attr(findFirst(container, 'rootfile'), 'full-path');
  if (!opfPath || !zip.file(opfPath)) throw new Error('Not a valid EPUB: the package document is missing.');

  const opf = parseXml(await zip.file(opfPath).async('string'));
  const meta = {
    title: findFirst(opf, 'dc:title')?.textContent?.trim() || undefined,
    author: findFirst(opf, 'dc:creator')?.textContent?.trim() || undefined,
    language: findFirst(opf, 'dc:language')?.textContent?.trim() || undefined,
    publisher: findFirst(opf, 'dc:publisher')?.textContent?.trim() || undefined,
  };

  const manifest = new Map();
  for (const item of findAll(opf, 'item')) {
    manifest.set(attr(item, 'id'), {
      href: resolveArchivePath(opfPath, attr(item, 'href')),
      type: attr(item, 'media-type') || '',
      properties: attr(item, 'properties') || '',
    });
  }

  const spine = findAll(opf, 'itemref')
    .map((ref) => manifest.get(attr(ref, 'idref')))
    .filter((item) => item && /xhtml|html/.test(item.type) && !/\bnav\b/.test(item.properties));

  const out = [];
  const warnings = [];
  if (meta.title) out.push(`<h1>${escapeHtml(meta.title)}</h1>`);
  if (meta.author) out.push(`<p><em>${escapeHtml(meta.author)}</em></p>`);

  const imageCache = new Map();
  for (let i = 0; i < spine.length; i++) {
    ctx.progress(0.05 + (i / spine.length) * 0.9, `Chapter ${i + 1} of ${spine.length}`);
    const item = spine[i];
    const file = zip.file(item.href);
    if (!file) {
      warnings.push(`Missing chapter file: ${item.href}`);
      continue;
    }
    try {
      const doc = parseHtmlDoc(await file.async('string'));
      const body = doc.body;
      if (!body) continue;
      body.querySelectorAll('script,style,link,meta').forEach((n) => n.remove());
      await inlineImages(body, zip, item.href, opts, imageCache);
      flattenInternalLinks(body);
      const html = body.innerHTML.trim();
      if (html) {
        if (out.length && i > 0) out.push('<hr data-smc-chapter="1">');
        out.push(html);
      }
    } catch (err) {
      warnings.push(`Chapter ${item.href} could not be read: ${err.message}`);
    }
  }

  if (spine.length > 40) {
    warnings.push(`This book has ${spine.length} sections — the Markdown file will be large.`);
  }

  return { html: out.join('\n'), warnings, meta: { ...meta, kind: 'epub', chapters: spine.length } };
}

async function inlineImages(root, zip, basePath, opts, cache) {
  const images = Array.from(root.querySelectorAll('img, image'));
  for (const img of images) {
    if (opts.imageMode === 'strip') {
      img.remove();
      continue;
    }
    const raw = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href');
    if (!raw || raw.startsWith('data:')) continue;
    const path = resolveArchivePath(basePath, raw);
    if (cache.has(path)) {
      img.setAttribute('src', cache.get(path));
      continue;
    }
    const file = zip.file(path);
    if (!file) {
      img.remove();
      continue;
    }
    const data = await file.async('uint8array');
    if (data.byteLength > (opts.maxImageBytes || Infinity)) {
      img.remove();
      continue;
    }
    const url = bytesToDataUrl(data, imageMimeFor(path));
    cache.set(path, url);
    img.setAttribute('src', url);
  }
}

/** Cross-chapter hrefs point at files that no longer exist once flattened. */
function flattenInternalLinks(root) {
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href');
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    a.replaceWith(...a.childNodes);
  }
}
