/**
 * OCR via the bundled Tesseract (Apache-2.0). Everything runs locally in a
 * Web Worker; no image ever leaves the machine.
 *
 * The worker is expensive to spin up (~1s + wasm compile), so it is created
 * once and reused across every page and file in a batch.
 */

import { getTesseract, TESSERACT_PATHS } from './vendor.js';
import { median } from './util/misc.js';

let workerPromise = null;
let workerLang = null;

/** Languages present in vendor/tessdata (see scripts/fetch-vendor.mjs --langs). */
export const BUNDLED_LANGUAGES = [{ code: 'eng', label: 'English' }];


async function createWorker(lang, onStatus) {
  const Tesseract = getTesseract();
  return Tesseract.createWorker(lang, Tesseract.OEM.LSTM_ONLY, {
    ...TESSERACT_PATHS,
    // MV3's worker-src 'self' forbids blob: workers, and we ship the
    // .traineddata pre-gzipped next to the worker.
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger: onStatus ? (m) => onStatus(m) : undefined,
  });
}

export async function getOcrWorker(lang = 'eng', onStatus) {
  if (workerPromise && workerLang !== lang) await terminateOcr();
  if (!workerPromise) {
    workerLang = lang;
    workerPromise = createWorker(lang, onStatus).catch((err) => {
      forgetWorker();
      throw new Error(`Could not start the OCR engine: ${err.message}`);
    });
  }
  return workerPromise;
}

/**
 * Drop the reference to a worker that is gone or never arrived.
 *
 * Whatever tracks worker configuration must be cleared here too. A worker that
 * fails to create used to clear only the promise, leaving the parameter cache
 * claiming the *next* worker was already configured — so it silently never
 * received user_defined_dpi or preserve_interword_spaces.
 */
function forgetWorker() {
  workerPromise = null;
  workerLang = null;
}

/**
 * Reproduces the state a failed worker creation leaves behind, which cannot be
 * provoked reliably from outside (an unavailable language hangs rather than
 * rejecting). Test-only; it makes the regression above permanent.
 */
export function __simulateLostWorker() {
  forgetWorker();
}

/**
 * Configuration is a property of a worker, so it is tracked against the worker
 * object rather than at module scope. Keyed by dpi alone, a cache outlives the
 * worker it describes and tells the next one it is already configured.
 */
const appliedParameters = new WeakMap();

/**
 * Telling Tesseract the true resolution matters more than it sounds: left to
 * guess, it estimates from glyph size and picks thresholds that are wrong for
 * an upsampled low-dpi scan. `preserve_interword_spaces` keeps the run of
 * spaces between form columns, which is what lets column structure survive.
 *
 * `tessedit_pageseg_mode` is deliberately absent. In tesseract.js 6.0.1 it is
 * accepted and discarded — setting it here, or as createWorker's init config,
 * leaves the recognized text byte-identical (measured: same hash on a corpus
 * page, both routes). A PSM option would be a knob that does nothing. The
 * question it was meant to answer was settled on the CLI instead: over 50
 * corpus rasters, PSM 6 glues "Tax ID:" into "TaxID:" on every one and reads
 * no more line-item codes than PSM 3, so PSM 3 is also the mode we want.
 */
async function applyParameters(worker, dpi, mode = 'default') {
  if (mode === 'none') return false; // diagnostic mode: a bare worker
  if (appliedParameters.get(worker) === dpi) return false;
  try {
    await worker.setParameters({
      user_defined_dpi: String(dpi),
      preserve_interword_spaces: '1',
    });
    appliedParameters.set(worker, dpi);
    return true;
  } catch {
    appliedParameters.delete(worker); // older builds without setParameters
    return false;
  }
}

export async function terminateOcr() {
  const p = workerPromise;
  forgetWorker();
  if (p) {
    try {
      (await p).terminate();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Recognize an image.
 *
 * Returns both views of the result: `paragraphs` for prose, and `lines` with
 * per-word geometry and confidence for anything that needs layout — tables,
 * headings, and knowing which characters the engine was unsure about.
 *
 * @param {ImageBitmap|HTMLCanvasElement|OffscreenCanvas|Blob|string} image
 */
export async function recognize(
  image,
  { lang = 'eng', dpi, parameters = 'default', onStatus } = {}
) {
  const worker = await getOcrWorker(lang, onStatus);
  const parametersApplied = dpi
    ? await applyParameters(worker, Math.round(dpi), parameters)
    : false;
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  return {
    confidence: data.confidence ?? 0,
    paragraphs: toParagraphs(data),
    lines: toLines(data),
    // Reported so a diagnostic run can prove a fresh worker was actually
    // configured, rather than assuming the cache let the call through.
    parametersApplied,
  };
}

/**
 * Flatten the block/paragraph/line tree to lines carrying their words' boxes
 * and confidences. Everything structural downstream is derived from this:
 * geometry gives us columns and headings, confidence gives us honesty.
 */
let wordsWithoutConfidence = 0;
let warnedAboutWordShape = false;

/**
 * Read a word's confidence, or report that we could not.
 *
 * The engine's word objects are the only source of confidence, and a version
 * that moved the field would previously have been coerced to `0` — turning
 * every word on the page into a false low-confidence flag with no error. An
 * unknown confidence is `null`: absent, not certainly-wrong.
 */
export function readWordConfidence(word) {
  const value = word?.confidence;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  wordsWithoutConfidence++;
  if (!warnedAboutWordShape) {
    warnedAboutWordShape = true;
    console.warn(
      '[Sumcheck] An OCR word arrived without a numeric confidence. The engine output ' +
        'shape may have changed; confidence reporting is unreliable for this run.'
    );
  }
  return null;
}

export function ocrDiagnostics() {
  return { wordsWithoutConfidence };
}

export function resetOcrDiagnostics() {
  wordsWithoutConfidence = 0;
  warnedAboutWordShape = false;
}

function toLines(data) {
  const out = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const words = (line.words || [])
          .map((w) => ({
            text: (w.text || '').trim(),
            confidence: readWordConfidence(w),
            x: w.bbox?.x0 ?? 0,
            x2: w.bbox?.x1 ?? 0,
            top: w.bbox?.y0 ?? 0,
            bottom: w.bbox?.y1 ?? 0,
            height: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
          }))
          .filter((w) => w.text);
        const text = words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        // Word heights include ascenders and descenders unevenly; the median is
        // far stabler than the max for comparing one line against another.
        const height = median(words.map((w) => w.height).filter((h) => h > 0));
        const known = words.map((w) => w.confidence).filter((c) => typeof c === 'number');
        out.push({
          text,
          words,
          confidence: line.confidence ?? (known.length ? median(known) : null),
          height,
          x: Math.min(...words.map((w) => w.x)),
          x2: Math.max(...words.map((w) => w.x2)),
          top: Math.min(...words.map((w) => w.top)),
          bottom: Math.max(...words.map((w) => w.bottom)),
        });
      }
    }
  }
  return out;
}

/**
 * Tesseract's block/paragraph/line/word tree carries glyph heights, which is
 * the only signal we have for "this line is a heading".
 *
 * Its own paragraph grouping is too coarse — a title sitting close above its
 * body text lands in the same paragraph — so lines are regrouped here on two
 * signals a human also uses: a change in type size, and a wider-than-usual gap.
 */
function toParagraphs(data) {
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = (line.text || '').trim();
        if (!text) continue;
        const heights = (line.words || [])
          .map((w) => (w.bbox ? w.bbox.y1 - w.bbox.y0 : 0))
          .filter((h) => h > 0);
        lines.push({
          text,
          height: median(heights) || 0,
          top: line.bbox?.y0 ?? 0,
          bottom: line.bbox?.y1 ?? 0,
        });
      }
    }
  }

  if (!lines.length) {
    return String(data.text || '')
      .split(/\n\s*\n/)
      .map((t) => joinLines(t.split('\n')))
      .filter(Boolean)
      .map((text) => ({ text, height: 0, lines: 1 }));
  }

  const out = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const text = joinLines(current.texts);
    // A lone character is specks, rule ends or scanner noise — never content,
    // with the obvious exceptions.
    const isNoise = text.length === 1 && !/[IA0-9]/.test(text);
    if (text && !isNoise) out.push({ text, height: current.height, lines: current.texts.length });
    current = null;
  };

  for (const line of lines) {
    const sizeShift =
      current && current.height && line.height
        ? Math.abs(line.height - current.height) / Math.max(current.height, 1)
        : 0;
    const gap = current ? line.top - current.bottom : 0;
    if (!current || sizeShift > 0.22 || gap > Math.max(current.height, 1) * 1.1) {
      flush();
      current = { texts: [], height: line.height, bottom: line.bottom };
    }
    current.texts.push(line.text);
    current.bottom = line.bottom;
    // Running mean keeps one tall line from dominating a long paragraph.
    current.height = current.height
      ? (current.height * (current.texts.length - 1) + line.height) / current.texts.length
      : line.height;
  }
  flush();
  return out;
}

/**
 * The "normal" text size in a page of OCR output, weighted by how much text is
 * set at each size. A plain median over paragraphs would let a two-paragraph
 * document average its heading and its body into a meaningless middle.
 *
 * @param {{text:string, height:number}[]} paragraphs
 */
export function bodyTextHeight(paragraphs) {
  const weighted = [];
  for (const para of paragraphs) {
    if (!para.height) continue;
    const weight = Math.max(1, Math.min(40, Math.round(para.text.length / 10)));
    for (let i = 0; i < weight; i++) weighted.push(para.height);
  }
  return median(weighted) || 1;
}

/** Undo hard line breaks, repairing hyphenated words split across lines. */
function joinLines(lines) {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/[‐-―-]$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
    else out += ' ' + line;
  }
  return out.replace(/\s+/g, ' ').trim();
}
