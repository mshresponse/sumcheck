/**
 * Word (.docx/.docm/.dotx) -> HTML via mammoth (BSD-2-Clause).
 *
 * mammoth deliberately maps *semantic styles* rather than direct formatting,
 * which is exactly what we want for Markdown: a "Heading 2" paragraph becomes
 * an <h2> instead of "18pt bold".
 */

import { getMammoth } from '../vendor.js';

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p.subtitle:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "p[style-name='Caption'] => figcaption:fresh",
  "p[style-name='Code'] => pre:separator('\\n')",
  "p[style-name='Source Code'] => pre:separator('\\n')",
  "p[style-name='Footnote Text'] => p.footnote:fresh",
  'r[style-name=\'Code Char\'] => code',
  "r[style-name='Book Title'] => cite",
  'b => strong',
  'i => em',
  'u => u',
  'strike => s',
];

export async function convertDocx(bytes, ctx) {
  const mammoth = getMammoth();
  ctx.progress(0.1, 'Reading document');

  const result = await mammoth.convertToHtml(
    { arrayBuffer: toArrayBuffer(bytes) },
    {
      styleMap: STYLE_MAP,
      includeDefaultStyleMap: true,
      ignoreEmptyParagraphs: true,
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.readAsBase64String();
        return {
          src: `data:${image.contentType};base64,${base64}`,
          alt: image.altText || '',
        };
      }),
    }
  );

  ctx.progress(0.9, 'Formatting');
  const warnings = [];
  const seen = new Set();
  for (const message of result.messages || []) {
    // mammoth emits one warning per *occurrence*; collapse them.
    const text = message.message.replace(/\s+/g, ' ').trim();
    if (message.type === 'warning' && !seen.has(text)) {
      seen.add(text);
      warnings.push(text);
    }
  }
  if (warnings.length > 8) {
    warnings.splice(8, warnings.length, `…and ${warnings.length - 8} more style warnings.`);
  }

  return {
    html: result.value,
    warnings,
    meta: { kind: 'docx' },
  };
}

function toArrayBuffer(bytes) {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
}
