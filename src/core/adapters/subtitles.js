/**
 * Subtitles (.srt / .vtt) -> a readable transcript.
 *
 * Cues are merged back into sentences — subtitle line breaks are display
 * artefacts, not sentence boundaries — with a timestamp anchor at the start of
 * each paragraph so quotes stay traceable to the video.
 */

import { decodeText, escapeHtml } from '../util/misc.js';

const TIME_RE =
  /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;

export async function convertSubtitles(bytes, ctx, detected) {
  const text = decodeText(bytes.buffer ?? bytes).replace(/\r\n?/g, '\n');
  const cues = [];

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^WEBVTT/i.test(l));
    if (!lines.length) continue;
    const timeLine = lines.findIndex((l) => TIME_RE.test(l));
    if (timeLine === -1) continue;
    const [, start] = TIME_RE.exec(lines[timeLine]);
    const body = lines
      .slice(timeLine + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '') // VTT inline tags: <v Speaker>, <i>, <c.classname>
      .replace(/\{\\[^}]*\}/g, '') // SSA/ASS override blocks
      .replace(/\s+/g, ' ')
      .trim();
    if (body) cues.push({ start: normalizeTime(start), text: body });
  }

  if (!cues.length) {
    return {
      html: '<p><em>(no subtitle cues found)</em></p>',
      warnings: ['No cues could be parsed from this subtitle file.'],
      meta: { kind: 'subtitles' },
    };
  }

  // Group cues into paragraphs: a new paragraph starts after a sentence ends or
  // after roughly 45 seconds of speech, whichever comes first.
  const paragraphs = [];
  let current = null;
  for (const cue of cues) {
    if (!current) current = { start: cue.start, parts: [] };
    const last = current.parts[current.parts.length - 1];
    if (last && /[.!?]["')\]]?$/.test(last) && seconds(cue.start) - seconds(current.start) > 20) {
      paragraphs.push(current);
      current = { start: cue.start, parts: [] };
    } else if (seconds(cue.start) - seconds(current.start) > 45) {
      paragraphs.push(current);
      current = { start: cue.start, parts: [] };
    }
    if (last === cue.text) continue; // rolling captions repeat the last line
    current.parts.push(cue.text);
  }
  if (current?.parts.length) paragraphs.push(current);

  const html = paragraphs
    .map(
      (p) =>
        // Bare timestamp rather than [00:00:01] — Markdown escapes brackets,
        // and `\[00:00:01\]` is unusable in a transcript.
        `<p><strong>${escapeHtml(p.start)}</strong> ${escapeHtml(dedupe(p.parts).join(' '))}</p>`
    )
    .join('\n');

  return {
    html,
    warnings: [],
    meta: { kind: 'subtitles', cues: cues.length, duration: cues[cues.length - 1].start },
  };
}

function normalizeTime(t) {
  const clean = t.replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 2) return `00:${parts[0].padStart(2, '0')}:${parts[1].split('.')[0]}`;
  return `${parts[0].padStart(2, '0')}:${parts[1]}:${parts[2].split('.')[0]}`;
}

function seconds(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Overlapping cues often repeat a trailing phrase; drop exact repeats. */
function dedupe(parts) {
  const out = [];
  for (const part of parts) if (out[out.length - 1] !== part) out.push(part);
  return out;
}
