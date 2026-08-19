/**
 * A diagnostic block for a bug report.
 *
 * The constraint is the feature. Everything here is a count, a setting or a
 * version — never a file name, never a title, never a word the converter read
 * out of the document, never a validator's message, never a path. A diagnostic
 * block that quotes the word OCR got wrong is a diagnostic block that has leaked
 * the document, and the person pasting it into a public issue has no way to know
 * that happened.
 *
 * The safety is structural rather than careful: this module assembles its output
 * from a fixed list of numbers and enumerated settings, and never receives the
 * converted text, the flag messages or the file name in the first place. There
 * is no string here that could carry content even if a future field were added
 * carelessly — `flagCounts` reduces flags to `{type: count}` before anything is
 * formatted, and the caller passes `meta` rather than the document.
 *
 * Only settings that differ from their defaults are reported, plus the output
 * set. A bug report's signal is what is unusual about the run, and twenty
 * default values printed in full bury the one that matters. The version is in
 * the block, so the defaults it was measured against are recoverable.
 *
 * `test/harness.js` asserts the negative: no twelve-character run of the
 * converted text appears in the output, and a nonsense word planted in the
 * fixture — including one the validator flags — appears nowhere.
 */

import { DEFAULT_OPTIONS } from './options.js';

/** Settings that change what a conversion produces. Order is display order. */
const REPORTED_SETTINGS = [
  'outputs',
  'ocrMode',
  'ocrResolution',
  'ocrLang',
  'ocrPreprocess',
  'ocrRescue',
  'ocrDetail',
  'pdfTables',
  'pdfHeadings',
  'pdfColumns',
  'stripRunningHeads',
  'pdfLinks',
  'pageMarkers',
  'repairStructure',
  'imageMode',
  'validate',
  'reviewMarkers',
  'frontMatter',
  'mdFlavor',
  'wrap',
];

/**
 * @param {object} input
 * @param {object} [input.meta] conversion metadata — counts and scalars only
 * @param {Array}  [input.review] validator flags; only their types are read
 * @param {object} [input.options] effective conversion settings
 * @param {string} [input.kind] detected source format, e.g. 'pdf'
 * @param {boolean}[input.failed] true when the conversion threw
 * @param {object} [input.runtime] {version, browser, platform} overrides
 * @returns {string} a pasteable block, newline separated
 */
export function buildDiagnostics({ meta = {}, review = [], options = {}, kind, failed, runtime } = {}) {
  const env = { ...detectRuntime(), ...(runtime || {}) };
  const lines = [];

  lines.push(join([`Sumcheck ${env.version}`, env.browser, env.platform]));

  lines.push(
    join([
      `source_format: ${plain(kind || meta.kind)}`,
      count('pages', meta.pages),
      count('slides', meta.slides),
      count('sheets', meta.sheets),
      failed ? 'status: conversion failed' : null,
    ])
  );

  lines.push(
    join([
      `ocr: ${meta.ocr || meta.ocrPages ? 'yes' : 'no'}`,
      count('ocr_pages', meta.ocrPages),
      value('ocr_dpi', meta.ocrDpi),
      value('ocr_confidence_mean', meta.ocrConfidenceMean),
      value('ocr_confidence_min', meta.ocrConfidenceMin),
      count('ocr_flagged_fields', meta.ocrFlaggedFields),
      count('ocr_unreadable_regions', meta.ocrUnreadableRegions),
    ])
  );

  const counts = flagCounts(review);
  lines.push(
    join([
      `review_flags: ${review.length}`,
      Object.keys(counts).length ? `by_type: ${Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(', ')}` : null,
      count('table_fallback', meta.tablesUnresolved),
    ])
  );

  lines.push(`settings: ${settingsLine(options)}`);

  return lines.filter(Boolean).join('\n');
}

/**
 * Flags reduced to a histogram of their types.
 *
 * This is where the leak would happen if it happened anywhere: a flag carries
 * `message` and `text`, both of which quote the document. Neither is read here,
 * and nothing downstream is given the flags themselves.
 */
export function flagCounts(review) {
  const out = {};
  for (const flag of review || []) {
    const type = plain(flag?.type || flag?.kind || 'other');
    out[type] = (out[type] || 0) + 1;
  }
  return out;
}

function settingsLine(options) {
  const parts = [];
  let defaulted = 0;
  for (const key of REPORTED_SETTINGS) {
    const raw = options?.[key];
    if (raw === undefined || raw === null) continue;
    // `outputs` is always shown: it decides which emitter ran, so it is context
    // for the report rather than a deviation from anything.
    if (key !== 'outputs' && same(raw, DEFAULT_OPTIONS[key])) {
      defaulted++;
      continue;
    }
    const shown = Array.isArray(raw) ? raw.map(plain).join('+') : plain(raw);
    parts.push(`${key}=${shown}`);
  }
  if (defaulted) parts.push(`(${defaulted} other setting${defaulted === 1 ? '' : 's'} at defaults)`);
  return parts.length ? parts.join(' · ') : '(defaults)';
}

const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

/**
 * Anything reaching the output passes through here.
 *
 * Settings are enumerated identifiers and versions are digits and dots, so this
 * only ever has to pass them through — but it is the backstop that keeps a
 * future field from carrying prose. Anything that is not an identifier, a
 * number or a short enumerated word is replaced rather than truncated, because
 * a truncated leak is still a leak.
 */
function plain(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  const text = String(value ?? '');
  return /^[A-Za-z0-9_.+-]{1,32}$/.test(text) ? text : '?';
}

const count = (label, n) => (Number.isFinite(n) && n > 0 ? `${label}: ${n}` : null);
const value = (label, n) => (n === undefined || n === null || n === '' ? null : `${label}: ${plain(n)}`);
const join = (parts) => parts.filter(Boolean).join(' · ');

/** Version and browser, from the extension runtime where there is one. */
function detectRuntime() {
  let version = '?';
  try {
    version = plain(globalThis.chrome?.runtime?.getManifest?.()?.version || '?');
  } catch {
    version = '?';
  }
  const ua = String(globalThis.navigator?.userAgent || '');
  const major = /Chrome\/(\d+)/.exec(ua)?.[1];
  // Platform families only. A full user-agent string carries build numbers that
  // narrow a reporter down further than a bug report needs.
  const platform = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Linux|X11/.test(ua)
          ? 'Linux'
          : '?';
  return { version, browser: major ? `Chrome ${major}` : 'Chrome ?', platform };
}
