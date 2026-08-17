/**
 * Images (.png/.jpg/.gif/.bmp/.webp/.tif) -> Markdown via OCR.
 *
 * Screenshots, scans and photos of documents all go through Tesseract locally.
 * Paragraph geometry from the OCR engine is used to promote oversized short
 * lines to headings, which is what makes a screenshot of a report read like a
 * report instead of a wall of text.
 */

import { recognize, bodyTextHeight } from '../ocr.js';
import { escapeHtml, bytesToDataUrl } from '../util/misc.js';

export async function convertImage(bytes, ctx, detected) {
  const opts = ctx.opts;
  if (opts.ocrMode === 'never') {
    throw new Error('This is an image, but OCR is turned off in Settings.');
  }

  const mime = detected?.mime || 'image/png';
  const blob = new Blob([bytes], { type: mime });

  let dimensions = null;
  try {
    const bitmap = await createImageBitmap(blob);
    dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
  } catch {
    /* TIFF and a few exotic formats can't be decoded by the browser; Tesseract
       still handles them through its own decoders. */
  }

  ctx.progress(0.15, 'Running OCR');
  const { paragraphs, confidence } = await recognize(blob, {
    lang: opts.ocrLang || 'eng',
    onStatus: (m) => {
      if (m.status === 'recognizing text') ctx.progress(0.15 + m.progress * 0.8, `OCR ${Math.round(m.progress * 100)}%`);
    },
  });

  const warnings = [];
  if (!paragraphs.length) warnings.push('No text was recognized in this image.');
  else if (confidence && confidence < 65) {
    warnings.push(
      `Low OCR confidence (${Math.round(confidence)}%). A higher-resolution scan usually fixes this.`
    );
  }

  const body = bodyTextHeight(paragraphs);

  const parts = [];
  if (opts.imageMode === 'embed' && bytes.byteLength <= (opts.maxImageBytes || Infinity)) {
    parts.push(`<p><img src="${bytesToDataUrl(bytes, mime)}" alt="${escapeHtml(ctx.name)}"></p>`);
  }

  for (const para of paragraphs) {
    const text = escapeHtml(para.text);
    const ratio = para.height ? para.height / body : 1;
    const short = para.text.length <= 90 && para.lines <= 2;
    if (short && ratio >= 1.7) parts.push(`<h1>${text}</h1>`);
    else if (short && ratio >= 1.35) parts.push(`<h2>${text}</h2>`);
    else if (short && ratio >= 1.18) parts.push(`<h3>${text}</h3>`);
    else if (/^\s*[•·▪‣*-]\s+/.test(para.text)) {
      parts.push(`<ul><li>${escapeHtml(para.text.replace(/^\s*[•·▪‣*-]\s+/, ''))}</li></ul>`);
    } else parts.push(`<p>${text}</p>`);
  }

  ctx.progress(1, 'Done');
  return {
    html: parts.join('\n'),
    warnings,
    meta: {
      kind: 'image',
      ocr: true,
      ocrConfidence: confidence ? Math.round(confidence) : undefined,
      ...(dimensions || {}),
    },
  };
}
