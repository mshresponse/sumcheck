/** Conversion options: defaults, metadata for the settings UI, persistence. */

export const DEFAULT_OPTIONS = {
  /** Which files to emit. Any subset of md | html | txt | json. */
  outputs: ['md'],

  // ---- Markdown shaping ----
  mdFlavor: 'gfm', // gfm | commonmark
  frontMatter: true, // YAML front matter with source metadata
  bulletMarker: '-',
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  linkStyle: 'inlined', // inlined | referenced
  wrap: 0, // hard-wrap column, 0 = off

  // ---- PDF ----
  pdfHeadings: true, // infer headings from font size / weight
  pdfTables: true, // reconstruct grid-aligned text into tables
  pdfColumns: 'auto', // auto | single
  stripRunningHeads: true, // drop repeated headers/footers and page numbers
  pageMarkers: 'comment', // none | comment | rule
  pdfLinks: true, // re-attach link annotations to their text

  // ---- OCR ----
  ocrMode: 'auto', // auto (only pages with no text layer) | always | never
  ocrLang: 'eng',
  /**
   * 'auto' detects a scan's own resolution and renders at a whole multiple of
   * it, targeting >= 200 dpi. Measured on a 96 dpi form, that is the difference
   * between reading 5 of 14 fields correctly and reading all 14 — Tesseract
   * needs roughly 30 px of x-height and a low-dpi scan gives it a fifth of
   * that. A number forces that DPI instead.
   */
  ocrResolution: 'auto', // 'auto' | 150 | 200 | 300 | 400
  /**
   * 'off' hands the pixels to Tesseract untouched. Its own binarization is
   * tuned for text; pre-processing is a second, cruder pass that eats thin
   * strokes — the "$" -> "3" failure mode. Only use 'contrast' for photographed
   * pages with uneven lighting.
   */
  ocrPreprocess: 'off', // off | contrast
  /**
   * Re-read regions that carried ink but produced no text, with local contrast
   * boosted. This is what recovers a figure printed inside a shaded callout box
   * — the whole box otherwise binarizes to one dark mass and its contents are
   * dropped, label and value together.
   */
  ocrRescue: true,
  /**
   * 'summary' records confidence scalars only. 'full' adds the per-word
   * low-confidence list, which is useful for a human review pass and pure
   * overhead on a bulk ingest.
   */
  ocrDetail: 'summary', // summary | full
  /**
   * Diagnostic only. 'none' starts a bare worker with no `user_defined_dpi` and
   * no `preserve_interword_spaces`, so a run can be compared against the shipped
   * configuration on identical pixels.
   */
  ocrParameters: 'default', // default | none
  ocrMinChars: 24, // below this many chars a PDF page counts as "scanned"

  // ---- Images ----
  imageMode: 'embed', // embed (data URI) | extract (files in zip) | link | strip
  maxImageBytes: 4 * 1024 * 1024,

  // ---- Spreadsheets ----
  sheetMode: 'table', // table | csv-block
  maxSheetRows: 5000,
  includeEmptySheets: false,

  // ---- Slides / docs ----
  includeSpeakerNotes: true,
  readability: true, // article extraction for web pages / HTML files

  /** Recover headings and lists from documents that only use direct formatting. */
  repairStructure: true,

  // ---- Verification ----
  /** Currency-sigil and line-item arithmetic checks. */
  validate: true,
  /** Write flags into the document as `<!-- SUMCHECK: … -->` comments. */
  reviewMarkers: true,
};

export const OUTPUT_FORMATS = [
  { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html' },
  { id: 'txt', label: 'Plain text', ext: 'txt', mime: 'text/plain' },
  { id: 'json', label: 'JSON (structured)', ext: 'json', mime: 'application/json' },
];

const STORAGE_KEY = 'sumcheck.options.v1';
/**
 * The key this used before the rename. Read once if the new key is empty, so
 * anyone who installed the extension as MDForge keeps their settings instead of
 * silently reverting to defaults. Renaming a storage key is a data migration,
 * not a find-and-replace.
 */
const LEGACY_STORAGE_KEY = 'mdforge.options.v1';

const hasChromeStorage = () =>
  typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

export async function loadOptions() {
  try {
    if (hasChromeStorage()) {
      const got = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
      const stored = got[STORAGE_KEY] || got[LEGACY_STORAGE_KEY] || {};
      return { ...DEFAULT_OPTIONS, ...stored };
    }
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return { ...DEFAULT_OPTIONS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export async function saveOptions(options) {
  const trimmed = {};
  for (const key of Object.keys(DEFAULT_OPTIONS)) trimmed[key] = options[key];
  try {
    if (hasChromeStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or unavailable — options simply don't persist */
  }
}
