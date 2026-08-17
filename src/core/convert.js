/**
 * The conversion pipeline.
 *
 *   bytes -> detect -> adapter -> HTML -> sanitize -> image policy -> emitters
 *
 * Every adapter's job is to produce HTML. Everything downstream of that is
 * shared, which is why adding a new input format only ever means adding one
 * file to ./adapters and one line to the registry below.
 */

import { detectFormat, KIND_LABELS } from './detect.js';
import { sanitizeHtml } from './sanitize.js';
import { repairStructure, REPAIRABLE_KINDS } from './postprocess.js';
import { validateDocument } from './validate.js';
import { DEFAULT_OPTIONS, OUTPUT_FORMATS } from './options.js';
import { baseName, safeFileName, extOf, merge, uid } from './util/misc.js';
import { createTurndown, toMarkdown, frontMatter } from './emit/markdown.js';
import { toStandaloneHtml } from './emit/html.js';
import { toPlainText } from './emit/text.js';
import { toJsonDocument } from './emit/json.js';

import { convertPdf } from './adapters/pdf.js';
import { convertDocx } from './adapters/docx.js';
import { convertXlsx } from './adapters/xlsx.js';
import { convertPptx } from './adapters/pptx.js';
import { convertOdf } from './adapters/odf.js';
import { convertEpub } from './adapters/epub.js';
import { convertHtml, convertHtmlString } from './adapters/html.js';
import { convertCsv } from './adapters/csv.js';
import { convertText, convertMarkdown, convertCode } from './adapters/text.js';
import { convertJson, convertJsonl, convertYaml, convertXml } from './adapters/data.js';
import { convertRtf } from './adapters/rtf.js';
import { convertImage } from './adapters/image.js';
import { convertEml, convertMhtml } from './adapters/eml.js';
import { convertIpynb } from './adapters/ipynb.js';
import { convertSubtitles } from './adapters/subtitles.js';

const ADAPTERS = {
  pdf: convertPdf,
  docx: convertDocx,
  xlsx: convertXlsx,
  pptx: convertPptx,
  odt: convertOdf,
  ods: convertOdf,
  odp: convertOdf,
  epub: convertEpub,
  html: convertHtml,
  mhtml: convertMhtml,
  csv: convertCsv,
  markdown: convertMarkdown,
  text: convertText,
  code: convertCode,
  rtf: convertRtf,
  json: convertJson,
  jsonl: convertJsonl,
  yaml: convertYaml,
  xml: convertXml,
  eml: convertEml,
  ipynb: convertIpynb,
  subtitles: convertSubtitles,
  image: convertImage,
};

export const SUPPORTED_EXTENSIONS = [
  '.pdf', '.docx', '.docm', '.dotx', '.xlsx', '.xlsm', '.xltx', '.pptx', '.pptm', '.potx',
  '.odt', '.ods', '.odp', '.epub', '.html', '.htm', '.xhtml', '.mhtml', '.mht',
  '.csv', '.tsv', '.psv', '.md', '.markdown', '.txt', '.log', '.rtf',
  '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.xml', '.eml', '.ipynb',
  '.srt', '.vtt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.zip',
];

/**
 * The tool's identity as written into every converted document.
 *
 * Deliberately not read from `manifest.name`. Once the manifest name is a
 * localised `__MSG_` placeholder, `getManifest()` resolves it to the reader's
 * UI language — and the `generator:` line in a converted file would then depend
 * on the language of whoever happened to run the conversion. That line is
 * product output: it says which tool produced the file, and that answer is the
 * same in every language. Only the version is read from the manifest.
 */
const PRODUCT_NAME = 'Sumcheck — PDF & Document to Markdown';

export function generatorString() {
  try {
    return `${PRODUCT_NAME} ${chrome.runtime.getManifest().version}`;
  } catch {
    return 'Sumcheck';
  }
}

/**
 * @param {{bytes:Uint8Array, name:string, mime?:string, url?:string, html?:string}} input
 * @param {object} userOptions
 * @param {{onProgress?:Function, requestPassword?:Function, signal?:AbortSignal}} hooks
 */
export async function convertFile(input, userOptions = {}, hooks = {}) {
  const opts = merge(DEFAULT_OPTIONS, userOptions);
  const name = input.name || 'document';
  const ctx = {
    name,
    opts,
    signal: hooks.signal,
    requestPassword: hooks.requestPassword,
    progress: (fraction, label) => hooks.onProgress?.(fraction, label),
    // Diagnostic hooks, forwarded so a harness can observe an adapter's
    // intermediate state. Undefined in normal use, and adapters guard on them.
    onOcrPage: hooks.onOcrPage,
    onLayout: hooks.onLayout,
    wantRaster: hooks.wantRaster,
  };

  // A captured tab arrives as HTML with a URL rather than as bytes.
  let detected;
  let result;
  if (input.html != null) {
    detected = { kind: 'html', ext: 'html' };
    result = await convertHtmlString(input.html, ctx, input.url);
  } else {
    detected = await detectFormat(input.bytes, name, input.mime);
    if (detected.kind === 'archive') {
      return { expand: await expandArchive(detected.zip), detected };
    }
    if (detected.kind === 'unsupported' || !ADAPTERS[detected.kind]) {
      throw new Error(
        detected.note || `Sumcheck can't read “${name}” (${KIND_LABELS[detected.kind] || 'unknown format'}).`
      );
    }
    result = await ADAPTERS[detected.kind](input.bytes, ctx, detected);
  }

  const warnings = [...(result.warnings || [])];
  const meta = {
    name,
    title: result.meta?.title || baseName(name),
    source: input.url || undefined,
    converted: new Date().toISOString(),
    generator: generatorString(),
    ...result.meta,
  };
  if (!meta.title) meta.title = baseName(name);

  ctx.progress(0.97, 'Cleaning up');
  const host = document.createElement('div');
  host.innerHTML = sanitizeHtml(result.html || '');
  if (opts.repairStructure !== false && REPAIRABLE_KINDS.has(detected.kind)) {
    repairStructure(host);
  }

  const review =
    opts.validate === false
      ? []
      : await validateDocument(host, {
          markers: opts.reviewMarkers !== false,
          ocr: Boolean(meta.ocr || meta.ocrPages),
        });
  for (const flag of review) warnings.push(`Check this value: ${flag.message}`);
  if (review.length) {
    meta.needsReview = true;
    meta.reviewFlags = review.length;
  }

  const assets = applyImagePolicy(host, opts, baseName(name), warnings);

  const requested = opts.outputs?.length ? opts.outputs : ['md'];
  const cleanHtml = host.innerHTML;
  const outputs = requested
    .map((format) =>
      renderOutputFormat(format, {
        html: cleanHtml,
        host,
        meta,
        opts,
        nativeMarkdown: result.nativeMarkdown,
        name,
      })
    )
    .filter(Boolean);

  ctx.progress(1, 'Done');
  // `preview` is the sanitized fragment the emitters ran on — the app renders
  // it directly so the preview pane never depends on an HTML output being
  // among the requested formats.
  return {
    outputs,
    meta,
    warnings,
    assets,
    detected,
    preview: cleanHtml,
    review,
    // Kept so a format the user did not pre-select can still be produced later
    // without re-reading the source file.
    nativeMarkdown: result.nativeMarkdown,
  };
}

/**
 * Renders one output format from an already-sanitized document fragment.
 *
 * Exported so the app can produce a format the user did not pre-select — the
 * conversion work is already done, and re-running it just to look at the HTML
 * would be wasteful and slow.
 *
 * @param {'md'|'html'|'txt'|'json'} format
 */
export function renderOutputFormat(format, { html, host, meta, opts, nativeMarkdown, name }) {
  const spec = OUTPUT_FORMATS.find((f) => f.id === format);
  if (!spec) return null;

  const root = host || fragmentFrom(html);
  let content;

  if (format === 'md') {
    // Markdown and notebook sources are already Markdown — round-tripping them
    // through HTML would lose footnotes, reference links and raw HTML.
    content = nativeMarkdown
      ? (opts.frontMatter ? frontMatter(meta) : '') + nativeMarkdown.trim() + '\n'
      : toMarkdown(html, opts, meta);
  } else if (format === 'html') {
    content = toStandaloneHtml(html, opts, meta);
  } else if (format === 'txt') {
    content = toPlainText(root);
  } else {
    content = JSON.stringify(toJsonDocument(root, opts, meta, createTurndown(opts)), null, 2) + '\n';
  }

  return {
    format,
    ext: spec.ext,
    mime: spec.mime,
    filename: `${safeFileName(baseName(name || meta.name || 'document'))}.${spec.ext}`,
    content,
  };
}

function fragmentFrom(html) {
  const node = document.createElement('div');
  node.innerHTML = html; // already sanitized upstream
  return node;
}

/* ---------------------------------------------------------- image policy */

/**
 * Applies the user's image setting to the converted document.
 * Returns the assets that need to travel next to the Markdown file.
 */
function applyImagePolicy(host, opts, base, warnings) {
  const assets = [];
  const images = Array.from(host.querySelectorAll('img'));
  if (!images.length) return assets;

  let stripped = 0;
  let index = 0;

  for (const img of images) {
    const src = img.getAttribute('src') || '';
    const isData = src.startsWith('data:');

    if (opts.imageMode === 'strip') {
      replaceWithAlt(img);
      stripped++;
      continue;
    }
    if (!isData) continue; // already a URL — nothing to do for any mode

    const parsed = parseDataUrl(src);
    if (!parsed) {
      replaceWithAlt(img);
      stripped++;
      continue;
    }
    if (parsed.bytes.byteLength > (opts.maxImageBytes || Infinity)) {
      replaceWithAlt(img);
      stripped++;
      continue;
    }

    if (opts.imageMode === 'link') {
      replaceWithAlt(img);
      stripped++;
    } else if (opts.imageMode === 'extract') {
      index++;
      const ext = extensionFor(parsed.mime);
      const path = `${safeFileName(base)}_assets/image-${String(index).padStart(3, '0')}.${ext}`;
      assets.push({ path, bytes: parsed.bytes, mime: parsed.mime });
      img.setAttribute('src', path);
    }
  }

  if (stripped) {
    warnings.push(
      opts.imageMode === 'strip'
        ? `${stripped} image(s) were removed (image mode: strip).`
        : `${stripped} embedded image(s) were dropped — they exceeded the size limit or the current image mode.`
    );
  }
  return assets;
}

function replaceWithAlt(img) {
  const alt = img.getAttribute('alt');
  if (alt && alt.trim()) img.replaceWith(img.ownerDocument.createTextNode(`[image: ${alt.trim()}]`));
  else img.remove();
}

function parseDataUrl(src) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  try {
    if (m[2]) {
      const binary = atob(m[3]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  } catch {
    return null;
  }
}

function extensionFor(mime) {
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
    'image/tiff': 'tiff', 'image/x-emf': 'emf', 'image/emf': 'emf',
  };
  return map[mime] || 'bin';
}

/* -------------------------------------------------------------- archives */

async function expandArchive(zip) {
  const entries = [];
  const files = Object.values(zip.files).filter((f) => !f.dir);
  for (const file of files) {
    if (/^__MACOSX\//.test(file.name) || /(^|\/)\.DS_Store$/.test(file.name)) continue;
    if (!SUPPORTED_EXTENSIONS.includes(`.${extOf(file.name)}`)) continue;
    if (extOf(file.name) === 'zip') continue; // no recursive expansion
    entries.push({
      id: uid('file'),
      name: file.name.split('/').pop(),
      path: file.name,
      bytes: await file.async('uint8array'),
    });
  }
  return entries;
}
