/**
 * PDF -> HTML.
 *
 * A PDF has no notion of a paragraph, a heading or a list — it is absolutely
 * positioned glyphs. Everything structural below is inferred from geometry:
 *
 *   glyph runs -> lines -> (columns) -> blocks -> headings / lists / tables
 *
 * Pages whose text layer is empty (scans, photocopies, image-only exports) are
 * rendered to a canvas and pushed through Tesseract instead.
 */

import { loadPdfjs, pdfDocumentDefaults } from '../vendor.js';
import { escapeHtml, median, clamp, yieldToUI } from '../util/misc.js';
import { buildNestedList } from '../util/lists.js';
import { recognize, bodyTextHeight } from '../ocr.js';

const BULLET_RE = /^\s*([•·▪◦‣∙◾▸►o])\s+/;
const ORDERED_RE = /^\s*\(?(\d{1,3}|[a-zA-Z]|[ivxlcdm]{1,6})[.)]\s+/;
const DASH_BULLET_RE = /^\s*[-–—*]\s+/;
const SENTENCE_END_RE = /[.!?:;"')\]]\s*$/;

export async function convertPdf(bytes, ctx) {
  const opts = ctx.opts;
  const pdfjs = await loadPdfjs();

  const task = pdfjs.getDocument({ data: bytes, ...pdfDocumentDefaults() });
  /**
   * Declining is a decision, not a failure, and the message has to say so.
   *
   * Destroying the task rejects `task.promise` with whatever the teardown
   * happens to throw — a worker error that tells the person nothing about why
   * their file did not convert. In a batch that difference matters: "you
   * skipped this" is actionable, "Worker was destroyed" is a bug report.
   */
  let declined = false;
  task.onPassword = (updatePassword, reason) => {
    const retry = reason === (pdfjs.PasswordResponses?.INCORRECT_PASSWORD ?? 2);
    Promise.resolve(ctx.requestPassword?.(retry)).then(
      (pw) => {
        if (pw == null) {
          declined = true;
          task.destroy();
        } else updatePassword(pw);
      },
      () => {
        declined = true;
        task.destroy();
      }
    );
  };

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (declined) {
      throw new Error('Skipped — this PDF is password protected and no password was entered.');
    }
    if (err?.name === 'PasswordException') {
      throw new Error('This PDF is password protected and no password was supplied.');
    }
    throw err;
  }

  const warnings = [];
  const meta = await readMetadata(doc);
  const pages = [];
  let ocrPages = 0;
  const ocrStats = {
    confidences: [],
    flagged: [],
    gaps: 0,
    rescued: 0,
    dpi: new Set(),
    lowResScans: 0,
  };

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (ctx.signal?.aborted) throw new Error('Conversion cancelled.');
      ctx.progress(((n - 1) / doc.numPages) * 0.95, `Page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const links = opts.pdfLinks === false ? [] : readLinks(pdfjs, await safeAnnotations(page), viewport);
      let lines = buildLines(pdfjs, textContent, viewport, links);
      let charCount = lines.reduce((a, l) => a + l.text.replace(/\s/g, '').length, 0);
      let ocred = false;

      const wantOcr =
        opts.ocrMode === 'always' ||
        (opts.ocrMode === 'auto' && charCount < (opts.ocrMinChars ?? 24));

      if (wantOcr) {
        ctx.progress(((n - 1) / doc.numPages) * 0.95, `OCR page ${n} of ${doc.numPages}`);
        try {
          const read = await ocrPage(pdfjs, page, opts, ctx, `page ${n} of ${doc.numPages}`, n);
          if (read.lines.length && (opts.ocrMode === 'always' || charCount < (opts.ocrMinChars ?? 24))) {
            lines = read.lines;
            charCount = lines.reduce((a, l) => a + l.text.length, 0);
            ocred = true;
            ocrPages++;
            recordOcrStats(ocrStats, read, n);
          }
        } catch (err) {
          warnings.push(`OCR failed on page ${n}: ${err.message}`);
        }
      }

      pages.push({ number: n, lines, width: viewport.width, height: viewport.height, ocred });
      page.cleanup();
      await yieldToUI();
    }

    if (opts.stripRunningHeads !== false) stripRunningHeads(pages, warnings);

    const bodySize = estimateBodySize(pages);
    // Inspection hook for the test harness: the layout decisions all hinge on
    // these numbers, and they are otherwise invisible from outside.
    ctx.onLayout?.(pages, bodySize);
    const html = renderPages(pages, bodySize, opts, meta);

    if (ocrPages) {
      warnings.push(
        `${ocrPages} of ${doc.numPages} page(s) had no text layer and were read with OCR — check those sections for recognition errors.`
      );
      Object.assign(meta, summarizeOcr(ocrStats, warnings, opts));
    }
    if (!ocrPages && opts.ocrMode === 'never') {
      const empty = pages.filter((p) => !p.lines.length).length;
      if (empty) warnings.push(`${empty} page(s) appear to be scans, but OCR is turned off.`);
    }

    ctx.progress(1, 'Done');
    return {
      html,
      warnings,
      meta: { ...meta, pages: doc.numPages, ocrPages, kind: 'pdf' },
    };
  } finally {
    // Destroying the loading task tears down the worker and the document proxy.
    await task.destroy().catch(() => {});
  }
}

async function readMetadata(doc) {
  try {
    const { info } = await doc.getMetadata();
    return {
      title: cleanMeta(info?.Title),
      author: cleanMeta(info?.Author),
      subject: cleanMeta(info?.Subject),
      keywords: cleanMeta(info?.Keywords),
      creator: cleanMeta(info?.Creator),
      producer: cleanMeta(info?.Producer),
      created: pdfDate(info?.CreationDate),
    };
  } catch {
    return {};
  }
}

const cleanMeta = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function pdfDate(raw) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw || '');
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

async function safeAnnotations(page) {
  try {
    return await page.getAnnotations({ intent: 'display' });
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ lines */

/**
 * Turn positioned glyph runs into lines of styled segments.
 * Coordinates are pushed through the viewport transform so rotated pages and
 * flipped axes are handled before any geometry heuristics run.
 */
function buildLines(pdfjs, textContent, viewport, links = []) {
  const styles = textContent.styles || {};
  const raw = [];

  for (const item of textContent.items) {
    if (!item.str || !item.transform) continue;
    if (!item.str.trim()) continue;
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(t[1], t[3]) || item.height || 10;
    const style = styles[item.fontName] || {};
    const fontName = `${style.fontFamily || ''} ${item.fontName || ''}`;
    const width = item.width || size * item.str.length * 0.5;
    const base = {
      text: item.str,
      x: t[4],
      y: t[5],
      width,
      size,
      bold: /bold|black|heavy|semib|demib|[-_]bd\b/i.test(fontName),
      italic: /italic|oblique|[-_]it\b/i.test(fontName),
      mono: /mono|courier|consol/i.test(fontName),
    };
    // Link rects are resolved before runs are merged into segments, so a linked
    // phrase inside a sentence becomes its own segment rather than swallowing
    // the whole line.
    raw.push(...splitByLinks(base, links));
  }
  if (!raw.length) return [];

  raw.sort((a, b) => a.y - b.y || a.x - b.x);

  // Cluster into lines by baseline proximity.
  const groups = [];
  let current = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const item = raw[i];
    const ref = current[current.length - 1];
    const tol = Math.max(2, Math.min(item.size, ref.size) * 0.5);
    if (Math.abs(item.y - ref.y) <= tol) current.push(item);
    else {
      groups.push(current);
      current = [item];
    }
  }
  groups.push(current);

  const lines = groups.map((group) => {
    group.sort((a, b) => a.x - b.x);
    const segments = [];
    let cursor = null;
    let prevEnd = null;
    for (const item of group) {
      const gapNeedsSpace =
        prevEnd !== null && item.x - prevEnd > item.size * 0.18 && !/\s$/.test(cursor?.text || ' ');
      const sameStyle =
        cursor &&
        cursor.bold === item.bold &&
        cursor.italic === item.italic &&
        cursor.mono === item.mono &&
        cursor.href === item.href;
      if (sameStyle) {
        cursor.text += (gapNeedsSpace ? ' ' : '') + item.text;
        cursor.x2 = item.x + item.width;
      } else {
        if (cursor) segments.push(cursor);
        cursor = {
          text: (gapNeedsSpace && segments.length ? ' ' : '') + item.text,
          bold: item.bold,
          italic: item.italic,
          mono: item.mono,
          href: item.href,
          x: item.x,
          x2: item.x + item.width,
        };
      }
      prevEnd = item.x + item.width;
    }
    if (cursor) segments.push(cursor);

    const sizes = group.map((g) => g.size);
    const text = segments.map((s) => s.text).join('').replace(/\s+/g, ' ').trim();
    const chars = Math.max(1, text.length);
    return {
      segments,
      text,
      x: group[0].x,
      x2: group[group.length - 1].x + group[group.length - 1].width,
      y: group[0].y,
      size: Math.max(...sizes),
      bold: group.every((g) => g.bold) && text.length > 1,
      italic: group.every((g) => g.italic),
      mono: group.every((g) => g.mono),
      chars,
      // gaps between glyph runs — the raw material for table detection
      cells: buildCells(group),
    };
  });

  return lines.filter((l) => l.text);
}

/** Split a line wherever the horizontal gap is wide enough to be a column. */
function buildCells(group) {
  const cells = [];
  let cur = null;
  let prevEnd = null;
  for (const item of group) {
    const gap = prevEnd === null ? 0 : item.x - prevEnd;
    if (!cur || gap > item.size * 1.4) {
      if (cur) cells.push(cur);
      cur = { text: item.text, x: item.x, x2: item.x + item.width, bold: item.bold };
    } else {
      cur.text += (gap > item.size * 0.18 ? ' ' : '') + item.text;
      cur.x2 = item.x + item.width;
      cur.bold = cur.bold && item.bold;
    }
    prevEnd = item.x + item.width;
  }
  if (cur) cells.push(cur);
  return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
}

/* -------------------------------------------------------------------- OCR */

/** Canvas budget for a rendered page. 8.5x11 at 300 dpi is ~8.4 MP. */
const MAX_OCR_PIXELS = 20e6;

/** A page with more unread regions than this is a scan quality problem. */
const MAX_RESCUE_REGIONS = 6;
/** Context kept around a cropped region so glyphs are not cut at the edge. */
const RESCUE_PADDING = 24;

/**
 * Cut a flagged region out of the page.
 *
 * The cropping is the point. Tesseract's page-level layout analysis decides
 * which blocks are text before recognizing any of them, and on these forms it
 * discards the block holding the headline total — the same pixels, handed over
 * without the surrounding page, read correctly. Measured on a corpus page: the
 * whole-page pass never emits the figure; the cropped region reads it at 77.
 */
function cropRegion(canvas, gap) {
  /**
   * The flagged rectangle covers the ink nobody read, which is often only part
   * of the thing that needs reading — half of a figure whose other half fell
   * under the density threshold. Padding scaled to the region's height pulls in
   * the rest of the line; a fixed margin recovered ".00" from "$226.00".
   */
  const band = Math.max(RESCUE_PADDING, (gap.y2 - gap.y) * 4);
  const x = Math.max(0, Math.floor(gap.x - band));
  const y = Math.max(0, Math.floor(gap.y - RESCUE_PADDING));
  const width = Math.min(canvas.width - x, Math.ceil(gap.x2 - gap.x + band * 2));
  const height = Math.min(canvas.height - y, Math.ceil(gap.y2 - gap.y + RESCUE_PADDING * 2));
  if (width < 12 || height < 12) return null;

  const cropped = document.createElement('canvas');
  cropped.width = width;
  cropped.height = height;
  const context = cropped.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return { canvas: cropped, context, x, y };
}

async function readCrop(cropCanvas, opts, dpi) {
  try {
    const { lines } = await recognize(cropCanvas, {
      lang: opts.ocrLang || 'eng',
      dpi,
      parameters: opts.ocrParameters || 'default',
    });
    return lines;
  } catch {
    return []; // a failed re-read leaves the region flagged, which is correct
  }
}

/**
 * Did the re-read actually recover text?
 *
 * Handed a signature or a smudge, OCR returns *something* — and accepting it
 * would clear the unread-ink flag, removing the marker that says a human should
 * look. Garbage must leave the region flagged, because an unmarked miss is the
 * one outcome this pipeline treats as unacceptable.
 */
function isRecoveredText(line) {
  const text = (line.text || '').trim();
  if ((text.match(/[A-Za-z0-9]/g) || []).length < 2) return false;
  return typeof line.confidence !== 'number' || line.confidence >= 40;
}

/**
 * Discard whatever a rescue crop read on top of ink the first pass already
 * read.
 *
 * A crop recognizes every pixel inside it, not just the unread ones, so a
 * region that is mostly-read returns the neighbouring words a second time. The
 * second reading is the worse one — it lacks the surrounding line to size
 * against — so the duplicates arrive degraded: "$1,932.00" came back as "$1.9"
 * and "32.00", and both were appended to the row, corrupting a money column
 * that the first pass had read correctly.
 *
 * Comparing text cannot catch this, because a misread does not equal what it
 * duplicates. Position can: a recovered word sitting on top of an existing one
 * is a re-read, whatever it says. "On top of" is more than half the recovered
 * word's own area, so a word that merely brushes its neighbour still counts as
 * new.
 */
export function dropAlreadyRead(lines, readWords) {
  const covered = (word) => {
    const area = Math.max(1, (word.x2 - word.x) * (word.bottom - word.top));
    return readWords.some((read) => {
      const w = Math.min(word.x2, read.x2) - Math.max(word.x, read.x);
      const h = Math.min(word.bottom, read.bottom) - Math.max(word.top, read.top);
      return w > 0 && h > 0 && (w * h) / area > 0.5;
    });
  };

  const out = [];
  for (const line of lines) {
    const words = (line.words || []).filter((w) => !covered(w));
    if (!words.length) continue;
    // A partly-duplicated line keeps only its new words, so the text it
    // contributes matches the geometry it is placed at.
    if (words.length === (line.words || []).length) {
      out.push(line);
      continue;
    }
    out.push({
      ...line,
      words,
      text: words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
      x: Math.min(...words.map((w) => w.x)),
      x2: Math.max(...words.map((w) => w.x2)),
      top: Math.min(...words.map((w) => w.top)),
      bottom: Math.max(...words.map((w) => w.bottom)),
    });
  }
  return out;
}

/** Move a line read from a crop back into page coordinates. */
function offsetLine(line, dx, dy) {
  return {
    ...line,
    x: line.x + dx,
    x2: line.x2 + dx,
    top: line.top + dy,
    bottom: line.bottom + dy,
    words: (line.words || []).map((w) => ({
      ...w,
      x: w.x + dx,
      x2: w.x2 + dx,
      top: w.top + dy,
      bottom: w.bottom + dy,
    })),
  };
}

/**
 * Render a page and read it with OCR.
 *
 * Resolution is the whole ballgame on scans, and the right answer is not the
 * intuitive one. Measured against ground truth on a 96 dpi billing form
 * (test/harness.js, "96 dpi billing form"), reading fields correctly:
 *
 *     native 96 dpi ............  5/14
 *     1.5x  (144 dpi) .......... 12/14   <- what v1.0.0 did
 *     2x    (192 dpi) .......... 14/14
 *     3.1x  (300 dpi) .......... 14/14, slower
 *
 * Tesseract wants roughly 30 px of x-height. A 96 dpi scan gives it about 6,
 * so it is guessing at glyph shapes — which is how a "$" loses its stroke and
 * reads as "3", and how a "1" thickens into a "4". Upsampling does not add
 * information, but it does give the classifier enough pixels to work with, and
 * that is what closes the gap.
 *
 * Note the 1.5x row: it recovers most of the page but still loses the shaded
 * headline figure and the URL — exactly the two defects reported from the
 * field. Under-scaling fails quietly on the hardest elements first.
 *
 * Returns lines with real page geometry, so headings, lists and tables are
 * derived from the same code that handles a text layer.
 */
async function ocrPage(pdfjs, page, opts, ctx, where = '', pageNumber = 1) {
  const base = page.getViewport({ scale: 1 });
  const auto = (opts.ocrResolution ?? 'auto') === 'auto';
  const scanDpi = auto ? await scannedImageDpi(pdfjs, page, base) : null;

  let targetDpi;
  if (scanDpi) {
    // Prefer a whole multiple of the scan's own grid: pixel boundaries line up,
    // so the resampler has less to invent.
    const multiple = scanDpi * 2 > 450 ? 1 : scanDpi * 2 >= 180 ? 2 : 3;
    targetDpi = scanDpi * multiple;
  } else {
    targetDpi = clamp(Number(opts.ocrResolution) || 300, 96, 600);
  }

  let scale = targetDpi / 72;
  if (base.width * base.height * scale * scale > MAX_OCR_PIXELS) {
    scale = Math.sqrt(MAX_OCR_PIXELS / (base.width * base.height));
  }
  const effectiveDpi = Math.round(scale * 72);

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: context, // pdf.js <= 5 wants the context; 6 wants the canvas
    viewport,
    background: '#ffffff',
    // Display intent drives rendering off requestAnimationFrame, which browsers
    // suspend in background tabs — a long OCR job would stall the moment the
    // user switched away. Print intent renders synchronously to completion.
    intent: 'print',
  }).promise;

  // Grayscale costs nothing in accuracy (measured: identical field scores) and
  // runs ~1.6x faster, because Tesseract skips its own colour conversion. It
  // also drops JPEG chroma fringing around thin strokes.
  toGrayscale(context, canvas);

  // Contrast work is off by default. Tesseract's own adaptive binarization is
  // tuned for text; pre-processing is a second, cruder pass over the same
  // decision, and cruder passes eat thin strokes. This is for photographed
  // pages with uneven lighting, where it earns its keep.
  if (opts.ocrPreprocess === 'contrast') normalizeLocalContrast(context, canvas);

  // `let`, not `const`: the rescue pass below merges more lines into this.
  let { lines, confidence } = await recognize(canvas, {
    lang: opts.ocrLang || 'eng',
    dpi: effectiveDpi,
    parameters: opts.ocrParameters || 'default',
    onStatus: (m) => {
      // Without the page context this reads as one counter restarting forever.
      if (m.status === 'recognizing text') {
        ctx.progress(undefined, `OCR ${where} — ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  let gaps = findUnrecognizedInk(context, canvas, lines);
  let rescued = 0;
  let rescueTrace = null;

  /**
   * Rescue pass.
   *
   * Text inside a shaded callout box is the classic casualty: Tesseract's global
   * binarization reads the box as one dark mass and drops its contents whole —
   * label and value together. Measured on a #d8d8d8 callout, the difference is
   * "Total Estimated Costs: $7,311.39" surviving or vanishing entirely.
   *
   * Local contrast normalization fixes it, but running it over the whole page
   * unconditionally is the very pre-processing that eats thin strokes elsewhere.
   * So it runs only where the first pass left ink unaccounted for, and only its
   * lines inside those regions are merged back in.
   */
  if (gaps.length && opts.ocrRescue !== false) {
    ctx.progress(undefined, `Re-reading unread areas of ${where}`);
    const seen = new Set(lines.map((l) => l.text));
    // What the first pass read, in page coordinates. A crop cannot tell which
    // of the pixels it was handed were already understood; this can.
    const readWords = lines.flatMap((l) => l.words || []);
    const found = [];
    const trace = [];

    for (const gap of gaps.slice(0, MAX_RESCUE_REGIONS)) {
      const region = cropRegion(canvas, gap);
      if (!region) continue;

      let read = await readCrop(region.canvas, opts, effectiveDpi);
      let via = 'crop';
      if (!read.length) {
        // Only now is contrast worth trying: the region is genuinely faint
        // rather than merely lost to page layout.
        normalizeLocalContrast(region.context, region.canvas);
        read = await readCrop(region.canvas, opts, effectiveDpi);
        via = 'crop+contrast';
      }
      region.canvas.width = region.canvas.height = 0;

      // Duplicates go first: a line is judged on the words it actually
      // contributes, not on the strength of the ones it re-read.
      const offset = read.map((line) => offsetLine(line, region.x, region.y));
      const deduped = dropAlreadyRead(offset, readWords);
      // Diagnostic only: the crop returned nothing the first pass had not
      // already read. That does NOT prove the region holds nothing new — it can
      // equally mean the crop failed to read the one value that matters, which
      // is what GFE (46) does. Clearing the gap on this signal unmarked a real
      // miss, so the gap decision is made from ink coverage instead.
      const alreadyRead = offset.length > 0 && deduped.length === 0;

      const fresh = deduped.filter((line) => isRecoveredText(line) && !seen.has(line.text));
      for (const line of fresh) seen.add(line.text);
      found.push(...fresh.map((line) => ({ ...line, source: 'rescue' })));
      trace.push({
        gap: { x: gap.x, y: gap.y, x2: gap.x2, y2: gap.y2, ink: gap.ink },
        via,
        alreadyRead,
        recovered: fresh.map((l) => l.text),
      });
    }

    rescueTrace = { regions: gaps.length, attempts: trace };
    if (found.length) {
      lines = [...lines, ...found].sort((a, b) => a.top - b.top || a.x - b.x);
      rescued = found.length;
      // Whatever the rescue recovered is no longer a gap.
      gaps = gaps.filter(
        (g) =>
          !found.some(
            (l) =>
              Math.min(l.x2, g.x2) - Math.max(l.x, g.x) > 0 &&
              Math.min(l.bottom, g.y2) - Math.max(l.top, g.y) > 0
          )
      );
    }
  }
  /**
   * Diagnostic hook: hands out the words exactly as `toLines()` produced them —
   * post-wrapper, pre-adapter, in render pixels — plus the raster they were read
   * from. Comparing a different engine's reading of *that same PNG* is the only
   * way to separate "our renderer makes different pixels" from "our engine is
   * configured differently". Costs nothing when nobody is listening.
   */
  if (ctx.onOcrPage) {
    ctx.onOcrPage({
      page: pageNumber,
      dpi: effectiveDpi,
      sourceDpi: scanDpi || null,
      parameters: opts.ocrParameters || 'default',
      lines,
      rescue: rescueTrace,
      raster: ctx.wantRaster ? canvas.toDataURL('image/png') : null,
    });
  }
  canvas.width = canvas.height = 0;

  const inv = 1 / scale;
  const pageLines = lines.map((line) => toPageLine(line, inv));
  attachGapMarkers(pageLines, gaps.map((g) => scaleRect(g, inv)));

  return {
    lines: pageLines,
    confidence,
    dpi: effectiveDpi,
    gaps: gaps.length,
    rescued,
    sourceDpi: scanDpi || null,
  };
}

function toGrayscale(context, canvas) {
  const { width, height } = canvas;
  if (!width || !height) return;
  const image = context.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = (px[i] * 77 + px[i + 1] * 151 + px[i + 2] * 28) >> 8;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  context.putImageData(image, 0, 0);
}

/**
 * If the page draws exactly one image and nothing else, report the resolution
 * that image is stored at. Knowing a page is "a 96 dpi scan" is what lets the
 * render target be chosen as a clean multiple of its pixel grid.
 */
async function scannedImageDpi(pdfjs, page, base) {
  if (base.rotation % 180 !== 0) return null;
  const withTimeout = (promise, ms) =>
    Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);

  try {
    const ops = await withTimeout(page.getOperatorList(), 4000);
    if (!ops) return null;

    const paintImage = pdfjs.OPS.paintImageXObject;
    const names = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === paintImage) names.push(ops.argsArray[i][0]);
    }
    if (names.length !== 1) return null; // not a plain scan

    const image = await withTimeout(
      new Promise((resolve) => {
        try {
          page.objs.get(names[0], resolve);
        } catch {
          resolve(null);
        }
      }),
      4000
    );
    const width = image?.width || image?.bitmap?.width;
    if (!width) return null;

    const dpi = Math.round((width / base.width) * 72);
    return dpi >= 36 && dpi <= 1200 ? dpi : null;
  } catch {
    return null;
  }
}

/** OCR line -> the same shape buildLines() produces for a text layer. */
function toPageLine(line, inv) {
  const size = (line.height || 10) * inv;
  const words = line.words.map((w) => ({
    text: w.text,
    confidence: w.confidence,
    x: w.x * inv,
    x2: w.x2 * inv,
  }));
  return {
    segments: [{ text: line.text, bold: false, italic: false, mono: false }],
    text: line.text,
    words,
    x: line.x * inv,
    x2: line.x2 * inv,
    y: line.bottom * inv,
    top: line.top * inv,
    size,
    bold: false,
    italic: false,
    mono: false,
    chars: line.text.length,
    confidence: line.confidence,
    cells: buildOcrCells(words, size),
    fromOcr: true,
  };
}

/**
 * Split a line where the horizontal gap is wide enough to be a column break.
 * This is what makes table reconstruction possible on a scan: the geometry is
 * the only record of which value sat under which heading.
 */
function buildOcrCells(words, size) {
  const cells = [];
  let cur = null;
  for (const word of words) {
    if (!cur || word.x - cur.x2 > size * 1.4) {
      if (cur) cells.push(cur);
      cur = { text: word.text, x: word.x, x2: word.x2 };
    } else {
      cur.text += ' ' + word.text;
      cur.x2 = word.x2;
    }
  }
  if (cur) cells.push(cur);
  return cells;
}

/**
 * Local (tile-wise) contrast normalization.
 *
 * A global stretch is useless on a typical form: the page already spans full
 * black to full white, so nothing moves — while the value inside a grey callout
 * box stays low-contrast and gets lost. Normalizing against a *local* min/max
 * lifts text out of shaded boxes, which is the documented cause of a headline
 * figure going missing while its label survives.
 */
export function normalizeLocalContrast(context, canvas) {
  const { width, height } = canvas;
  if (!width || !height) return;
  const image = context.getImageData(0, 0, width, height);
  const px = image.data;

  const TILE = 48;
  const cols = Math.max(1, Math.ceil(width / TILE));
  const rows = Math.max(1, Math.ceil(height / TILE));
  const mins = new Uint8Array(cols * rows).fill(255);
  const maxs = new Uint8Array(cols * rows);

  const lum = (i) => (px[i] * 77 + px[i + 1] * 151 + px[i + 2] * 28) >> 8;

  // Pass 1: per-tile extremes, subsampled — exact values are not needed.
  for (let y = 0; y < height; y += 2) {
    const row = Math.min(rows - 1, (y / TILE) | 0);
    for (let x = 0; x < width; x += 2) {
      const v = lum((y * width + x) * 4);
      const cell = row * cols + Math.min(cols - 1, (x / TILE) | 0);
      if (v < mins[cell]) mins[cell] = v;
      if (v > maxs[cell]) maxs[cell] = v;
    }
  }

  // Pass 2: stretch each pixel against its tile, and flatten tiles that hold no
  // real contrast so paper texture and JPEG noise are not amplified into specks.
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, (y / TILE) | 0);
    for (let x = 0; x < width; x++) {
      const cell = row * cols + Math.min(cols - 1, (x / TILE) | 0);
      const lo = mins[cell];
      const hi = maxs[cell];
      const i = (y * width + x) * 4;
      let v;
      if (hi - lo < 40) v = 255;
      else v = clamp(Math.round(((lum(i) - lo) * 255) / (hi - lo)), 0, 255);
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * Find inked areas of the page that produced no words.
 *
 * This is the answer to silent omission: if the converter drops a value it
 * could not read, the ink is still on the page, and comparing ink against
 * recognized word boxes shows exactly where the output is incomplete.
 */
function findUnrecognizedInk(context, canvas, lines) {
  const { width, height } = canvas;
  if (!width || !height) return [];
  const CELL = 16;
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const ink = new Float32Array(cols * rows);
  const covered = new Uint8Array(cols * rows);

  const image = context.getImageData(0, 0, width, height);
  const px = image.data;
  for (let y = 0; y < height; y += 2) {
    const row = (y / CELL) | 0;
    for (let x = 0; x < width; x += 2) {
      if (px[(y * width + x) * 4] < 140) ink[row * cols + ((x / CELL) | 0)] += 1;
    }
  }
  const cellSamples = (CELL / 2) * (CELL / 2);

  for (const line of lines) {
    for (const word of line.words) {
      const x0 = Math.max(0, ((word.x - 4) / CELL) | 0);
      const x1 = Math.min(cols - 1, ((word.x2 + 4) / CELL) | 0);
      const y0 = Math.max(0, ((word.top - 4) / CELL) | 0);
      const y1 = Math.min(rows - 1, ((word.bottom + 4) / CELL) | 0);
      for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) covered[r * cols + c] = 1;
    }
  }

  const readWords = lines.flatMap((line) => line.words || []);

  /**
   * How tall a line of this page's own text is. The yardstick has to come from
   * the page because it is measured in rendered pixels, and the renderer picks
   * its scale per document.
   *
   * Zero when nothing was read at all — a page the engine failed on entirely
   * must still be able to flag its ink, so the test below is skipped then.
   */
  const lineHeight = median(readWords.map((w) => w.bottom - w.top).filter((h) => h > 0));

  // Flood-fill the uncovered inky cells into regions.
  const seen = new Uint8Array(cols * rows);
  const regions = [];
  const isInky = (i) => !covered[i] && ink[i] / cellSamples > 0.06;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (seen[start] || !isInky(start)) continue;
      const stack = [start];
      seen[start] = 1;
      let minC = c, maxC = c, minR = r, maxR = r, cells = 0, inkSum = 0;
      while (stack.length) {
        const i = stack.pop();
        const cr = (i / cols) | 0;
        const cc = i % cols;
        cells++;
        inkSum += ink[i];
        if (cc < minC) minC = cc;
        if (cc > maxC) maxC = cc;
        if (cr < minR) minR = cr;
        if (cr > maxR) maxR = cr;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (seen[ni] || !isInky(ni)) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      const box = {
        x: minC * CELL,
        y: minR * CELL,
        x2: (maxC + 1) * CELL,
        y2: (maxR + 1) * CELL,
        cells,
        ink: inkSum,
      };
      const w = box.x2 - box.x;
      const h = box.y2 - box.y;
      // Rules, borders and box outlines are ink but not content.
      const isRule = (h <= CELL * 1.5 && w > CELL * 4) || (w <= CELL * 1.5 && h > CELL * 4);
      const density = inkSum / (cells * cellSamples);
      if (cells < 3 || isRule || density < 0.08) continue;
      /**
       * A region shorter than one line of text cannot be hiding a value.
       *
       * The gaps between right-aligned money columns are the case this catches:
       * on GFE (49) they came through as four 64x16 slivers carrying ink=32,
       * against ink=729..918 for the six regions that hold a genuinely
       * unrecovered figure. Left in, each sliver produced a "value not
       * recovered" marker on a document whose every value was read correctly,
       * and the crops around them re-read the money column and corrupted it.
       *
       * Measured across the corpus, those four slivers are the only regions
       * below one line height (0.73x); every real miss sits at 2.91x.
       */
      if (lineHeight && h < lineHeight) continue;
      /**
       * Ink that surrounds text we already read is background, not a gap.
       *
       * A title reversed out of a solid bar is the case that matters: the bar
       * is ~50% dark, the word boxes cover only the white glyphs, and the
       * leftover reads as a large unread region. Left in, it produced a
       * "value not recovered" marker on pages missing nothing, and the rescue
       * pass re-read the banner and duplicated the title on every page.
       */
      if (wordsInside(readWords, box) >= 2) continue;
      regions.push(box);
    }
  }
  return regions.sort((a, b) => b.ink - a.ink).slice(0, 8);
}

const scaleRect = (r, k) => ({ x: r.x * k, y: r.y * k, x2: r.x2 * k, y2: r.y2 * k });

/**
 * How many words we already read sit *inside* this region?
 *
 * Area coverage is the wrong measure — glyphs are a small fraction of a filled
 * bar, so a reversed-out banner looks "uncovered" however its ink is counted.
 * Containment is the honest question: a region holding several recognized words
 * is text we read, and the surrounding dark is background. A scrawl beside a
 * paragraph contains none of them, so it still gets flagged.
 */
function wordsInside(words, box) {
  let inside = 0;
  for (const word of words) {
    const cx = (word.x + word.x2) / 2;
    const cy = (word.top + word.bottom) / 2;
    if (cx >= box.x && cx <= box.x2 && cy >= box.y && cy <= box.y2) inside++;
  }
  return inside;
}

/**
 * Words below this score are worth a second look.
 *
 * Calibrated against this pipeline, not against a textbook: measured on real
 * upscaled scans, correct words routinely land in the high 70s and low 80s. A
 * threshold of 85 flagged them by the hundred, and a flag that fires constantly
 * on correct data teaches people to ignore flags — which costs more than having
 * no flags at all.
 */
const LOW_CONFIDENCE = 70;

function recordOcrStats(stats, read, pageNumber) {
  stats.dpi.add(read.dpi);
  stats.gaps += read.gaps;
  stats.rescued += read.rescued || 0;
  if (read.sourceDpi && read.sourceDpi < 150) stats.lowResScans++;
  for (const line of read.lines) {
    for (const word of line.words || []) {
      if (typeof word.confidence !== 'number') continue;
      // Word-level scores, so the reported minimum belongs to the same
      // population as the flagged list rather than to line averages.
      stats.confidences.push(word.confidence);
      if (word.confidence < LOW_CONFIDENCE) {
        stats.flagged.push({
          text: word.text,
          confidence: Math.round(word.confidence * 10) / 10,
          page: pageNumber,
        });
      }
    }
  }
}

/**
 * Confidence is the difference between a silent wrong answer and a visible one.
 * Tesseract hands it to us for free and v1 threw it away.
 */
function summarizeOcr(stats, warnings, opts = {}) {
  if (!stats.confidences.length) return {};
  const mean = stats.confidences.reduce((a, b) => a + b, 0) / stats.confidences.length;
  const min = Math.min(...stats.confidences);
  const flagged = stats.flagged
    .filter((f) => /[A-Za-z0-9]/.test(f.text))
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, 20);

  if (stats.rescued) {
    warnings.push(
      `${stats.rescued} line(s) were only readable after boosting local contrast — typically text inside a shaded box. Worth confirming against the original.`
    );
  }
  if (mean < 85) {
    warnings.push(
      `Average OCR confidence is ${mean.toFixed(1)}% — treat every figure in this document as unverified.`
    );
  }
  if (flagged.length) {
    warnings.push(
      `${stats.flagged.length} word(s) scored below ${LOW_CONFIDENCE}% confidence; the lowest are listed in the front matter.`
    );
  }
  if (stats.gaps) {
    warnings.push(
      `${stats.gaps} region(s) of the page carried ink but produced no text — something there was not read. Look for shaded boxes, stamps or handwriting.`
    );
  }
  if (stats.lowResScans) {
    warnings.push(
      `${stats.lowResScans} page(s) are low-resolution scans (under 150 dpi). They were upscaled before OCR, but a better scan of the original would read more reliably.`
    );
  }

  return {
    ocrConfidenceMean: Math.round(mean * 10) / 10,
    ocrConfidenceMin: Math.round(min * 10) / 10,
    ocrFlaggedFields: stats.flagged.length,
    // The summary scalars are cheap and always useful. The per-word list was
    // ~30% of every converted file on a bulk run, which nobody reads — so it is
    // opt-in, and the scalars still tell a pipeline whether to look closer.
    ocrLowConfidence: opts.ocrDetail === 'full' ? flagged : undefined,
    ocrDpi: [...stats.dpi].sort((a, b) => a - b).join(', '),
    ocrUnreadableRegions: stats.gaps || undefined,
    ocrRescuedLines: stats.rescued || undefined,
  };
}

/**
 * Tie an unreadable region to the label it belongs to, so the gap surfaces
 * where a reader will notice it rather than as a page-level footnote.
 */
function attachGapMarkers(lines, gaps) {
  for (const gap of gaps) {
    let best = null;
    let bestDistance = Infinity;
    for (const line of lines) {
      const below = gap.y - line.y;
      const rightOf = gap.x - line.x2;
      const sameRow = Math.abs(line.y - gap.y2) < line.size * 2;
      // A label sits directly above its value, or immediately to its left.
      const distance =
        below >= -line.size && below < line.size * 4
          ? below
          : sameRow && rightOf > 0 && rightOf < line.size * 30
            ? rightOf
            : Infinity;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = line;
      }
    }
    if (best && bestDistance < Infinity) best.unreadableNearby = true;
    else if (lines.length) lines[lines.length - 1].unreadableAfter = true;
  }
}

/* ------------------------------------------------------------- page chrome */

/**
 * Headers, footers and page numbers repeat at the same height on most pages.
 * Normalizing digits away lets "Page 4 of 30" and "Page 5 of 30" match.
 */
function stripRunningHeads(pages, warnings) {
  if (pages.length < 2) return;
  const counts = new Map();
  const key = (line) => line.text.replace(/\d+/g, '#').slice(0, 80);

  for (const page of pages) {
    for (const line of candidateChrome(page)) {
      const k = key(line);
      if (k.length < 2) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  // Must recur on most pages, and on at least two — a line seen once is content.
  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  const repeated = new Set([...counts].filter(([, c]) => c >= threshold).map(([k]) => k));
  if (!repeated.size) return;

  let removed = 0;
  for (const page of pages) {
    const drop = new Set(candidateChrome(page).filter((l) => repeated.has(key(l))));
    if (drop.size) {
      page.lines = page.lines.filter((l) => !drop.has(l));
      removed += drop.size;
    }
  }
  if (removed) warnings.push(`Removed ${removed} repeated header/footer line(s).`);
}

function candidateChrome(page) {
  const top = page.height * 0.08;
  const bottom = page.height * 0.92;
  return page.lines.filter((l) => (l.y <= top || l.y >= bottom) && l.text.length <= 120);
}

function estimateBodySize(pages) {
  const weighted = [];
  for (const page of pages) {
    for (const line of page.lines) {
      const weight = Math.min(50, Math.ceil(line.chars / 4));
      for (let i = 0; i < weight; i++) weighted.push(Math.round(line.size * 10) / 10);
    }
  }
  // No text layer anywhere: every page came from OCR, whose sizes are already
  // normalized around 1.
  return median(weighted) || 1;
}

/* ------------------------------------------------------------------ links */

/** pdf.js 6 applies the transform in place and returns nothing; 4/5 returned it. */
function toViewport(pdfjs, point, transform) {
  const result = pdfjs.Util.applyTransform(point, transform);
  return result || point;
}

function readLinks(pdfjs, annotations, viewport) {
  return annotations
    .filter((a) => a.subtype === 'Link' && (a.url || a.unsafeUrl))
    .map((a) => {
      // Annotation rects are in PDF user space; push both corners through the
      // viewport transform so rotation and the flipped Y axis are handled.
      const [ax, ay] = toViewport(pdfjs, [a.rect[0], a.rect[1]], viewport.transform);
      const [bx, by] = toViewport(pdfjs, [a.rect[2], a.rect[3]], viewport.transform);
      const [x1, y1, x2, y2] = pdfjs.Util.normalizeRect([ax, ay, bx, by]);
      return { url: a.url || a.unsafeUrl, x1, y1, x2, y2 };
    });
}

/**
 * pdf.js merges adjacent glyph runs, so a sentence containing a link usually
 * arrives as one text item with the link rect covering only part of it. Slice
 * the item where the rect starts and ends, using measured glyph advances and
 * snapping to word boundaries.
 */
function splitByLinks(item, links) {
  if (!links.length || !item.width) return [item];
  const hit = links.find(
    (l) =>
      item.y >= l.y1 - 2 &&
      item.y <= l.y2 + 2 &&
      Math.min(item.x + item.width, l.x2) - Math.max(item.x, l.x1) > 1
  );
  if (!hit) return [item];

  const covered =
    (Math.min(item.x + item.width, hit.x2) - Math.max(item.x, hit.x1)) / item.width;
  if (covered >= 0.85) return [{ ...item, href: hit.url }];

  const offsets = measureOffsets(item.text, item.size, item.width);
  let start = snapWordStart(item.text, indexAtOffset(offsets, hit.x1 - item.x));
  let end = snapWordEnd(item.text, indexAtOffset(offsets, hit.x2 - item.x));
  if (end <= start) return [{ ...item, href: hit.url }];

  const piece = (from, to, href) =>
    from >= to
      ? null
      : {
          ...item,
          text: item.text.slice(from, to),
          x: item.x + offsets[from],
          width: offsets[to] - offsets[from],
          href,
        };

  return [piece(0, start, undefined), piece(start, end, hit.url), piece(end, item.text.length, undefined)].filter(
    Boolean
  );
}

let measureContext = null;

/** Cumulative x offset of every character index, scaled to the item's real width. */
function measureOffsets(text, size, width) {
  const uniform = () => text.split('').map((_, i) => (i / text.length) * width).concat([width]);
  try {
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
    if (!measureContext) return uniform();
    measureContext.font = `${size}px Helvetica, Arial, sans-serif`;
    const total = measureContext.measureText(text).width;
    if (!total) return uniform();
    const scale = width / total;
    const offsets = new Array(text.length + 1);
    for (let i = 0; i <= text.length; i++) {
      offsets[i] = measureContext.measureText(text.slice(0, i)).width * scale;
    }
    return offsets;
  } catch {
    return uniform();
  }
}

function indexAtOffset(offsets, target) {
  for (let i = 0; i < offsets.length; i++) if (offsets[i] >= target) return i;
  return offsets.length - 1;
}

function snapWordStart(text, index) {
  let i = clamp(index, 0, text.length);
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

function snapWordEnd(text, index) {
  let i = clamp(index, 0, text.length);
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

/* ----------------------------------------------------------------- render */

function renderPages(pages, bodySize, opts, meta) {
  const out = [];
  const state = {
    tablesBuilt: 0,
    tablesUnresolved: 0,
    titleUsed: Boolean(meta.title),
    // Used to drop the cover-page title when it just repeats the PDF metadata.
    docTitle: meta.title ? normalizeHeading(meta.title) : null,
  };

  if (meta.title) out.push(`<h1>${escapeHtml(meta.title)}</h1>`);

  for (const page of pages) {
    // The marker is always emitted: Markdown honours the pageMarkers setting,
    // while HTML and JSON keep it so a chunk can be cited back to a page.
    if (out.length) out.push(`<hr data-smc-page="${page.number}">`);

    const columns = opts.pdfColumns === 'single' ? [page.lines] : splitColumns(page);
    for (const columnLines of columns) {
      out.push(renderBlocks(columnLines, bodySize, opts, state));
      state.titleUsed = true;
    }
  }
  meta.tablesBuilt = state.tablesBuilt;
  meta.tablesUnresolved = state.tablesUnresolved;
  return out.filter(Boolean).join('\n');
}

const normalizeHeading = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Two-column detection: look for a vertical band with no text that splits the
 * page's used width roughly in half. Anything more exotic (3+ columns, mixed
 * layouts) falls back to single-column reading order.
 */
function splitColumns(page) {
  const lines = page.lines;
  if (lines.length < 12) return [lines];
  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...lines.map((l) => l.x2));
  const width = right - left;
  if (width < page.width * 0.4) return [lines];

  const mid = left + width / 2;
  const band = width * 0.06;
  const crossing = lines.filter((l) => l.x < mid - band && l.x2 > mid + band);
  // Full-width lines (titles, footnotes) are allowed, but not many of them.
  if (crossing.length > lines.length * 0.2) return [lines];

  const leftCol = lines.filter((l) => l.x2 <= mid + band && !crossing.includes(l));
  const rightCol = lines.filter((l) => l.x >= mid - band && !crossing.includes(l));
  if (leftCol.length < 5 || rightCol.length < 5) return [lines];

  const heads = crossing.filter((l) => l.y < (leftCol[0]?.y ?? 0));
  return [heads, leftCol, rightCol].filter((c) => c.length);
}

function renderBlocks(lines, bodySize, opts, state) {
  if (!lines.length) return '';
  const out = [];
  const tables = opts.pdfTables === false ? new Map() : detectTables(lines, bodySize);
  for (const value of tables.values()) if (value.render && value.rows) state.tablesBuilt++;
  state.tablesUnresolved += (tables.unresolved || []).length;

  const leftEdge = median(lines.map((l) => l.x));
  let para = null;
  let list = null;

  const flushPara = () => {
    if (para) {
      out.push(`<p>${para.html}</p>`);
      para = null;
    }
  };
  const flushList = () => {
    if (list) {
      out.push(renderList(list));
      list = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const table = tables.get(line);
    if (table) {
      flushAll();
      if (table.render) out.push(table.preformatted ? renderAligned(table.preformatted) : renderTable(table));
      continue;
    }

    const heading = opts.pdfHeadings === false ? 0 : headingLevel(line, bodySize, state);
    if (heading) {
      flushAll();
      if (state.docTitle && normalizeHeading(line.text) === state.docTitle) {
        state.docTitle = null; // the cover title, already emitted from metadata
        continue;
      }
      const text = inlineHtml(line.segments, { plain: true }) + markerFor(line);
      out.push(`<h${heading}>${text}</h${heading}>`);
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      flushPara();
      const level = clamp(Math.round((line.x - leftEdge) / Math.max(bodySize * 1.4, 1)), 0, 4);
      const html = inlineHtml(stripMarker(line.segments, marker.length), {});
      if (!list || list.ordered !== marker.ordered) {
        flushList();
        list = { ordered: marker.ordered, items: [] };
      }
      list.items.push({ level, html });
      continue;
    }

    if (list && continuesListItem(line, lines[i - 1], bodySize)) {
      list.items[list.items.length - 1].html += ' ' + inlineHtml(line.segments, {});
      continue;
    }
    flushList();

    const html = inlineHtml(line.segments, {}) + markerFor(line);
    const prev = lines[i - 1];
    if (para && !startsNewParagraph(line, prev, bodySize, leftEdge)) {
      para.html = joinWrapped(para.html, html);
    } else {
      flushPara();
      para = { html };
    }
  }
  flushAll();
  return out.join('\n');
}

function joinWrapped(a, b) {
  if (/[‐-―-]$/.test(a) && /^[a-zà-ÿ]/.test(b.replace(/^<[^>]+>/, ''))) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

function startsNewParagraph(line, prev, bodySize, leftEdge) {
  if (!prev) return true;
  if (line.paragraph) return true;
  const gap = line.y - prev.y;
  if (gap > line.size * 2.1) return true;
  if (Math.abs(line.size - prev.size) > Math.max(1, bodySize * 0.22)) return true;
  // A short previous line that ended a sentence means the paragraph ended too.
  const prevWidth = prev.x2 - prev.x;
  if (SENTENCE_END_RE.test(prev.text) && prevWidth < (line.x2 - leftEdge) * 0.72) return true;
  // First-line indent.
  if (line.x > prev.x + bodySize * 0.8) return true;
  return false;
}

function continuesListItem(line, prev, bodySize) {
  if (!prev) return false;
  return line.x > prev.x + bodySize * 0.4 && line.y - prev.y < line.size * 2;
}

function headingLevel(line, bodySize, state) {
  const text = line.text;
  if (!text || text.length > 200) return 0;
  const ratio = line.size / bodySize;
  const short = text.length <= 120;
  const endsLikeProse = /[.,;]$/.test(text) && text.length > 40;
  if (endsLikeProse) return 0;

  let level = 0;
  if (ratio >= 1.85) level = 1;
  else if (ratio >= 1.45) level = 2;
  else if (ratio >= 1.22) level = 3;
  else if (ratio >= 1.09 && short) level = 4;
  else if (line.bold && short && ratio >= 0.95 && /[A-Za-z]/.test(text)) level = 4;
  else if (short && /^\d+(\.\d+)*\.?\s+\S/.test(text) && line.bold) level = 4;

  if (!level) return 0;

  if (line.fromOcr) {
    // Glyph height is the only size signal OCR gives, and it is noisy enough
    // that a wrapped descriptor can out-measure body text. Reject the shapes
    // that are cell fragments outright, and clamp what remains: depth beyond
    // `##` is not a distinction OCR can support. Clamping rather than rejecting
    // matters — a document title whose ratio only reaches h3 is still a title.
    if (rejectedOcrHeading(text)) return 0;
    level = Math.min(level, 2);
  }

  if (level === 1) {
    if (state.titleUsed) level = 2;
    else state.titleUsed = true;
  }
  return level;
}

/**
 * Shapes that are wrapped table-cell text rather than headings.
 *
 * Kept as data because this heuristic family is where the project has
 * repeatedly grown fragile — each entry is a shape observed in the real corpus,
 * and adding one should not mean threading another condition into a chain.
 *
 *   MATERIAL(S)                                  uppercase descriptor tail
 *   (EG, FOR FOLLICLES)                          opens mid-parenthetical
 *   (Forearm)/Wrist/Heel (Appendicular)          opens mid-parenthetical
 *   HEEL)                                        unbalanced close
 *   08-14-2026 CT Angiography Coronary (…)       a table row, not a heading
 */
export const OCR_HEADING_REJECTIONS = [
  ['opens-mid-parenthetical', (text) => /^[([]/.test(text)],
  ['unbalanced-brackets', (text) => !bracketsBalanced(text)],
  ['leading-date', (text) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/.test(text)],
  [
    'uppercase-descriptor-fragment',
    (text) => /[()]/.test(text) && /[A-Z]/.test(text) && text === text.toUpperCase() && text.length <= 48,
  ],
];

/** @returns {string|null} the name of the rule that rejected it */
export function rejectedOcrHeading(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'empty';
  for (const [name, test] of OCR_HEADING_REJECTIONS) if (test(trimmed)) return name;
  return null;
}

function bracketsBalanced(text) {
  let round = 0;
  let square = 0;
  for (const ch of text) {
    if (ch === '(') round++;
    else if (ch === ')') round--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
    if (round < 0 || square < 0) return false;
  }
  return round === 0 && square === 0;
}

function listMarker(line) {
  const text = line.text;
  let m = BULLET_RE.exec(text);
  if (m) return { ordered: false, length: m[0].length };
  m = DASH_BULLET_RE.exec(text);
  if (m && text.length > m[0].length + 1) return { ordered: false, length: m[0].length };
  m = ORDERED_RE.exec(text);
  if (m && text.length > m[0].length + 1) return { ordered: true, length: m[0].length };
  return null;
}

function stripMarker(segments, count) {
  let left = count;
  const out = [];
  for (const seg of segments) {
    if (left <= 0) {
      out.push(seg);
      continue;
    }
    const raw = seg.text;
    if (raw.length <= left) {
      left -= raw.length;
      continue;
    }
    out.push({ ...seg, text: raw.slice(left) });
    left = 0;
  }
  return out.length ? out : [{ text: '' }];
}

function renderList(list) {
  return buildNestedList(list.items, list.ordered);
}

/* ----------------------------------------------------------------- tables */

/**
 * Conservative table reconstruction: a run of consecutive lines that all split
 * into the same column positions is almost certainly a table. Anything less
 * consistent is left as prose, because a wrong table is worse than no table.
 */
export function detectTables(lines, bodySize) {
  const assignment = new Map();
  // Columnar runs that produced nothing — reported so no case is silent.
  const unresolved = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].cells.length < 2) {
      i++;
      continue;
    }
    let j = i;
    const run = [];
    const consumed = [];
    // Row-to-row spacing observed so far. A table's own pitch is a far better
    // yardstick than glyph height, which OCR measures inconsistently.
    const rowGaps = [];

    while (j < lines.length) {
      const line = lines[j];
      const prev = run.length ? run[run.length - 1] : null;
      // Measured from the last line consumed, not the last *row* — with a
      // wrapped continuation in between, a row-to-row gap looks like a break in
      // the table when it is just normal leading.
      const previousY = consumed.length ? consumed[consumed.length - 1].y : line.y;

      if (line.cells.length >= 2) {
        // Ruled tables are generously leaded — measured pitch on real forms is
        // ~4x the glyph height, so a 3x bound cuts the table off at row two.
        const limit = Math.max(line.size, bodySize) * 4;
        if (consumed.length && line.y - previousY > limit) break;
        if (prev) rowGaps.push(line.y - prev.line.y);
        run.push({ line, continuations: [] });
        consumed.push(line);
        j++;
        continue;
      }
      /**
       * A long description wraps to a second visual line, which arrives as a
       * single fragment sitting under the row it belongs to. Treating that as
       * the end of the table is why a four-row invoice produced no table at
       * all — and why the wrapped text ended up printed after the money
       * columns. Absorb it into its row instead.
       */
      const previousLine = consumed.length ? consumed[consumed.length - 1] : null;
      if (prev && previousLine && isWrappedCell(line, previousLine, prev.line)) {
        prev.continuations.push(line);
        consumed.push(line);
        j++;
        continue;
      }
      break;
    }

    if (run.length >= 3) {
      const table = buildTable(run, bodySize);
      const mark = (payload) => {
        assignment.set(consumed[0], { ...payload, render: true });
        for (const l of consumed.slice(1)) assignment.set(l, { render: false });
      };
      if (table) {
        mark(table);
        i = j;
        continue;
      }
      // The rows do not share a clean column grid, but they are clearly
      // columnar. A run-on paragraph would destroy which value belongs to which
      // row; a preformatted block at least preserves the spatial relationship.
      if (run.every((entry) => entry.line.cells.length >= 3)) {
        mark({ preformatted: run.map((entry) => entry.line) });
        i = j;
        continue;
      }
      /**
       * Columnar rows that resolved into neither a grid nor an aligned block.
       * The text still reaches the output as prose, but the columns are gone,
       * and a reader has no way to tell that from a document that never had a
       * table. Recording it is what makes that case speakable: on GFE (46) —
       * a zero-charge research scan with a single total row and no line item —
       * the money columns appear exactly once, so nothing can align to them.
       */
      unresolved.push({ rows: run.length, cells: run[0].line.cells.length });
    }
    i++;
  }
  assignment.unresolved = unresolved;
  return assignment;
}

/**
 * Is this single fragment the continuation of the row above — i.e. a cell whose
 * text wrapped? It must sit close below, and horizontally inside the row's span
 * rather than starting a new left-aligned block.
 */
/**
 * Is this lone fragment the continuation of the row above — a cell whose text
 * wrapped — or the start of something else?
 *
 * The question is which *column* it falls in, so it is asked against the last
 * real row, which is what defines the columns. Comparing against the previous
 * fragment instead is what stopped a table from forming at all on most of the
 * corpus: wrapped description text is ragged, so a continuation one word longer
 * than the line above it read as "extends past the previous line" and ended the
 * table. On GFE (47) the description wrapped to four lines whose right edges
 * varied by 75 units, and the run died on the second one.
 *
 * A fragment belongs to the row above when it sits close below it, starts under
 * one of its cells, and stops before the next one. Ragged right edges are then
 * normal; crossing into the neighbouring column is not. Prose after the table
 * is excluded by the same test, because it starts at the page margin, left of
 * every cell in the row.
 */
function isWrappedCell(line, previous, row) {
  const height = Math.max(line.size, previous.size);
  const gap = line.y - previous.y;
  if (gap <= 0 || gap > height * 2) return false;
  // The last cell starting at or before this fragment, with a glyph of slack
  // for a ragged left edge.
  let index = -1;
  row.cells.forEach((cell, k) => {
    if (cell.x <= line.x + height) index = k;
  });
  if (index < 0) return false;
  const next = row.cells[index + 1];
  return !next || line.x2 <= next.x;
}

function buildTable(run, bodySize) {
  const tolerance = Math.max(bodySize * 0.9, 4);
  const anchors = [];
  for (const { line } of run) {
    for (const cell of line.cells) {
      const hit = anchors.find((a) => Math.abs(a.x - cell.x) <= tolerance);
      if (hit) {
        hit.x = (hit.x * hit.n + cell.x) / (hit.n + 1);
        hit.n++;
      } else anchors.push({ x: cell.x, n: 1 });
    }
  }
  anchors.sort((a, b) => a.x - b.x);
  /**
   * A column is a position where cells line up. One cell is not an alignment;
   * two are.
   *
   * Requiring a proportion of the rows instead threw away every sparse column,
   * and a form's first column is sparse by design: the service date is printed
   * once and the line items beneath it are blank there. Dropping it did not
   * just lose that column — the row carrying the date then had both its cells
   * fall into the description column, collapsed to a single filled cell, and
   * failed the "a row needs two columns" test below, which rejected the whole
   * table. That is why 47 of the 50 documents produced no table at all while
   * their geometry was clean.
   */
  const columns = anchors.filter((a) => a.n >= 2);
  if (columns.length < 2) return null;

  const columnFor = (x) => {
    let best = -1;
    let bestDist = Infinity;
    columns.forEach((col, idx) => {
      const d = Math.abs(col.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    });
    return { index: best, distance: bestDist };
  };

  // Most cells must land in the shared column grid. Demanding that *every* cell
  // fit throws away real tables: header labels are commonly left-aligned inside
  // a column whose figures are right-aligned, so the header row alone can sit
  // 70 units off the data grid and used to reject the whole table.
  /**
   * Fragments are collected with their x before anything is joined, because the
   * indent is the only record of structure *inside* a cell.
   *
   * A reference table's cell often holds its own definition list — a label, its
   * value indented beneath — and joining on sight flattens
   * "Type / reference / Properties / Create, Filter" into one run-on sentence.
   * The label/value distinction survives only as the horizontal offset, so the
   * offset has to reach the renderer.
   */
  const grid = [];
  let cells = 0;
  let misfits = 0;
  for (const { line, continuations } of run) {
    const row = columns.map(() => []);
    for (const cell of line.cells) {
      const { index, distance } = columnFor(cell.x);
      cells++;
      if (distance > tolerance * 2.2) misfits++;
      row[index].push(cell);
    }
    if (row.filter((fragments) => fragments.length).length < 2) return null;
    // Wrapped text rejoins the cell it belongs to, so a description stays in
    // the description column instead of trailing after the amounts.
    for (const extra of continuations) {
      for (const cell of extra.cells) row[columnFor(cell.x).index].push(cell);
    }
    grid.push(row);
  }

  /**
   * Which columns hold a definition list, decided per column rather than per
   * cell.
   *
   * Deciding per cell makes a column render inconsistently: a field with one
   * pair looks like prose while its neighbour with six looks like a list.
   * Deciding once, from every fragment in the column, means a single-pair cell
   * formats the same way as the rest — and demanding two distinct labels stops
   * one wrapped line that happens to be indented from inventing a structure
   * that is not there.
   */
  const definitionColumn = columns.map((_, index) => {
    const fragments = grid.flatMap((row) => row[index]);
    if (fragments.length < 4) return false;
    const left = Math.min(...fragments.map((f) => f.x));
    const labels = fragments.filter((f) => f.x - left <= tolerance);
    const values = fragments.filter((f) => f.x - left > tolerance);
    return labels.length >= 2 && values.length >= 2;
  });

  const rows = grid.map((row) =>
    row.map((fragments, index) =>
      definitionColumn[index] ? cellPairs(fragments, tolerance) : joinFragments(fragments)
    )
  );
  // Scattered misfits are alignment noise; widespread ones mean this was never
  // a table.
  if (misfits / Math.max(1, cells) > 0.35) return null;

  const headerIsBold = run[0].line.cells.every((c) => c.bold);
  return { rows, header: headerIsBold || rows.length > 2 };
}

/**
 * Fallback for columnar text that will not resolve into a clean grid: rebuild
 * the spacing from the x positions inside a code block. Ugly, but every value
 * stays on the row it belongs to, which is the information at risk.
 */
function renderAligned(run) {
  const unit = Math.max(1, median(run.map((l) => l.size)) * 0.5);
  const left = Math.min(...run.map((l) => l.cells[0].x));
  const lines = run.map((line) => {
    let out = '';
    for (const cell of line.cells) {
      const column = Math.round((cell.x - left) / unit);
      if (column > out.length) out += ' '.repeat(column - out.length);
      else if (out.length) out += ' ';
      out += cell.text;
    }
    return out.replace(/\s+$/, '');
  });
  return `<pre><code>${escapeHtml(lines.join('\n'))}</code></pre>`;
}


/** A cell with no internal structure: its fragments, in reading order. */
function joinFragments(fragments) {
  return fragments.map((f) => f.text).join(' ');
}

/**
 * Split a definition-list cell into its label/value pairs.
 *
 * Fragments arrive in reading order. One at the column's left edge opens a
 * pair; anything indented past it belongs to the pair above, which is how a
 * label with several values — a bulleted list under "Possible values are" —
 * keeps all of them.
 *
 * Returns a plain string if the fragments do not actually partition that way,
 * so a column that only mostly looks like a definition list still renders its
 * odd cell as text rather than as a mangled pair.
 */
function cellPairs(fragments, tolerance) {
  if (!fragments.length) return '';
  const left = Math.min(...fragments.map((f) => f.x));
  const pairs = [];
  for (const fragment of fragments) {
    if (fragment.x - left <= tolerance) pairs.push({ label: fragment.text, values: [] });
    else if (pairs.length) pairs[pairs.length - 1].values.push(fragment.text);
    else return joinFragments(fragments); // a value before any label
  }
  if (!pairs.some((pair) => pair.values.length)) return joinFragments(fragments);
  return { pairs: pairs.map(({ label, values }) => [label, values.join(' ')]) };
}

function renderTable(table) {
  const [first, ...rest] = table.rows;
  /**
   * Pairs render as `label: value` separated by real `<br>` elements — the one
   * line break a GFM table cell can carry. Every part is escaped individually;
   * the break is markup, the content never is.
   */
  const cell = (value, tag) => {
    if (value && Array.isArray(value.pairs)) {
      const body = value.pairs
        .map(([label, text]) => `${escapeHtml(label)}: ${escapeHtml(text)}`)
        .join('<br>');
      return `<${tag}>${body}</${tag}>`;
    }
    return `<${tag}>${escapeHtml(value)}</${tag}>`;
  };
  const head = table.header
    ? `<thead><tr>${first.map((c) => cell(c, 'th')).join('')}</tr></thead>`
    : '';
  const bodyRows = table.header ? rest : table.rows;
  const body = `<tbody>${bodyRows
    .map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<table>${head}${body}</table>`;
}

/* ----------------------------------------------------------------- inline */

/**
 * A label whose value could not be read must say so. Silent omission is the one
 * defect class a reader cannot detect without the original in front of them.
 */
const UNREADABLE_MARKER =
  '<span data-smc-review="value not recovered — the page has content here that OCR could not read">⚠</span>';

const markerFor = (line) => (line.unreadableNearby || line.unreadableAfter ? UNREADABLE_MARKER : '');

function inlineHtml(segments, { plain = false } = {}) {
  let out = '';
  for (const seg of segments) {
    let text = escapeHtml(seg.text);
    if (!text) continue;
    if (!plain) {
      if (seg.mono) text = `<code>${text}</code>`;
      if (seg.bold) text = `<strong>${text}</strong>`;
      if (seg.italic) text = `<em>${text}</em>`;
    }
    if (seg.href) text = `<a href="${escapeHtml(seg.href)}">${text}</a>`;
    out += text;
  }
  return out.replace(/\s+/g, ' ').trim();
}
