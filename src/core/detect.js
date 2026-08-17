/**
 * Format detection: magic bytes first, file extension second, MIME type last.
 *
 * Extensions lie (a .doc that is really RTF, a .txt that is really CSV), so the
 * byte signature always wins when there is one.
 */

import { extOf } from './util/misc.js';
import { getJSZip } from './vendor.js';

const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

const MAGIC = [
  { kind: 'pdf', sig: ascii('%PDF-') },
  { kind: 'zip', sig: [0x50, 0x4b, 0x03, 0x04] },
  { kind: 'zip', sig: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
  { kind: 'rtf', sig: ascii('{\\rtf') },
  { kind: 'ole', sig: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { kind: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47] },
  { kind: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { kind: 'image/gif', sig: ascii('GIF8') },
  { kind: 'image/bmp', sig: ascii('BM') },
  { kind: 'image/tiff', sig: [0x49, 0x49, 0x2a, 0x00] },
  { kind: 'image/tiff', sig: [0x4d, 0x4d, 0x00, 0x2a] },
];

const EXT_KIND = {
  pdf: 'pdf',
  docx: 'docx',
  docm: 'docx',
  dotx: 'docx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  xltx: 'xlsx',
  pptx: 'pptx',
  pptm: 'pptx',
  potx: 'pptx',
  odt: 'odt',
  ods: 'ods',
  odp: 'odp',
  epub: 'epub',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  mhtml: 'mhtml',
  mht: 'mhtml',
  csv: 'csv',
  tsv: 'csv',
  psv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  txt: 'text',
  log: 'text',
  text: 'text',
  rtf: 'rtf',
  json: 'json',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'code',
  xml: 'xml',
  eml: 'eml',
  ipynb: 'ipynb',
  srt: 'subtitles',
  vtt: 'subtitles',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  bmp: 'image',
  webp: 'image',
  tif: 'image',
  tiff: 'image',
  pbm: 'image',
  // Anything that is plainly source code gets fenced rather than parsed.
  js: 'code', mjs: 'code', ts: 'code', tsx: 'code', jsx: 'code', py: 'code',
  rb: 'code', go: 'code', rs: 'code', java: 'code', c: 'code', h: 'code',
  cpp: 'code', cs: 'code', php: 'code', sh: 'code', sql: 'code', css: 'code',
  ini: 'code', conf: 'code', swift: 'code', kt: 'code', r: 'code',
};

const ZIP_PROBES = [
  { path: 'word/document.xml', kind: 'docx' },
  { path: 'xl/workbook.xml', kind: 'xlsx' },
  { path: 'ppt/presentation.xml', kind: 'pptx' },
  { path: 'META-INF/container.xml', kind: 'epub' },
];

const ODF_MIME_KIND = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/epub+zip': 'epub',
};

/**
 * @returns {Promise<{kind:string, ext:string, zip?:object, note?:string}>}
 */
export async function detectFormat(bytes, name = '', mime = '') {
  const head = bytes.subarray(0, 16);
  const ext = extOf(name);
  const magic = MAGIC.find((m) => startsWith(head, m.sig));

  if (magic?.kind === 'pdf') return { kind: 'pdf', ext };
  if (magic?.kind === 'rtf') return { kind: 'rtf', ext };
  if (magic?.kind?.startsWith('image/')) return { kind: 'image', ext, mime: magic.kind };
  if (magic?.kind === 'ole') {
    return {
      kind: 'unsupported',
      ext,
      note:
        'This is a legacy Microsoft Office 97–2003 file (.doc/.xls/.ppt). ' +
        'Re-save it as .docx/.xlsx/.pptx (or export to PDF) and convert that.',
    };
  }

  if (magic?.kind === 'zip') {
    const zip = await getJSZip().loadAsync(bytes);
    const mimetype = zip.file('mimetype');
    if (mimetype) {
      const declared = (await mimetype.async('string')).trim();
      if (ODF_MIME_KIND[declared]) return { kind: ODF_MIME_KIND[declared], ext, zip };
    }
    for (const probe of ZIP_PROBES) {
      if (zip.file(probe.path)) return { kind: probe.kind, ext, zip };
    }
    // A plain .zip: treat as a batch of files, expanded by the caller.
    return { kind: 'archive', ext, zip };
  }

  if (EXT_KIND[ext]) return { kind: EXT_KIND[ext], ext };

  if (mime) {
    if (mime.startsWith('image/')) return { kind: 'image', ext, mime };
    if (mime.includes('html')) return { kind: 'html', ext };
    if (mime.includes('json')) return { kind: 'json', ext };
    if (mime.includes('csv')) return { kind: 'csv', ext };
    if (mime.startsWith('text/')) return { kind: 'text', ext };
  }

  // Last resort: if it decodes as UTF-8 without control-byte noise, call it text.
  return { kind: looksTextual(bytes) ? 'text' : 'unsupported', ext };
}

function looksTextual(bytes) {
  const sample = bytes.subarray(0, 4096);
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / Math.max(1, sample.length) < 0.02;
}

/** Human label for the queue UI. */
export const KIND_LABELS = {
  pdf: 'PDF',
  docx: 'Word',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
  odt: 'OpenDocument Text',
  ods: 'OpenDocument Sheet',
  odp: 'OpenDocument Slides',
  epub: 'EPUB',
  html: 'HTML',
  mhtml: 'MHTML',
  csv: 'Delimited text',
  markdown: 'Markdown',
  text: 'Text',
  code: 'Source code',
  rtf: 'RTF',
  json: 'JSON',
  jsonl: 'JSON Lines',
  yaml: 'YAML',
  xml: 'XML',
  eml: 'Email',
  ipynb: 'Notebook',
  subtitles: 'Subtitles',
  image: 'Image (OCR)',
  archive: 'ZIP archive',
  unsupported: 'Unsupported',
};
