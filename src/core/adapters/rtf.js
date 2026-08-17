/**
 * RTF -> HTML.
 *
 * A focused subset of the spec: groups, control words, destinations we skip
 * (font tables, stylesheets, pictures, metadata), unicode escapes, and the
 * character formatting that actually survives a trip to Markdown.
 */

import { escapeHtml } from '../util/misc.js';

const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'generator', 'listtable',
  'listoverridetable', 'rsidtbl', 'xmlnstbl', 'filetbl', 'header', 'footer',
  'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'ftnsep', 'nonshppict',
]);

const SPECIALS = {
  par: '\n\n', line: '\n', tab: '\t', page: '\n\n',
  emdash: '—', endash: '–', emspace: ' ', enspace: ' ',
  lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•',
};

export async function convertRtf(bytes, ctx) {
  const text = new TextDecoder('windows-1252').decode(bytes);
  const blocks = parse(text);
  const html = blocks
    .map((block) => {
      const inner = block.runs
        .map((run) => {
          let t = escapeHtml(run.text).replace(/\n/g, '<br>').replace(/\t/g, ' ');
          if (!t.trim()) return t;
          if (run.bold) t = `<strong>${t}</strong>`;
          if (run.italic) t = `<em>${t}</em>`;
          if (run.underline) t = `<u>${t}</u>`;
          return t;
        })
        .join('');
      if (!inner.trim()) return '';
      return block.heading ? `<h${block.heading}>${inner}</h${block.heading}>` : `<p>${inner}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return { html: html || '<p><em>(no readable text)</em></p>', warnings: [], meta: { kind: 'rtf' } };
}

function parse(rtf) {
  const stack = [];
  let state = { bold: false, italic: false, underline: false, size: 0, skip: false };
  const blocks = [];
  let runs = [];
  let buffer = '';
  let codepage = 1252;
  let decoder = new TextDecoder('windows-1252');
  let unicodeSkip = 1;
  let pendingSkip = 0;

  const pushRun = () => {
    if (buffer) {
      runs.push({
        text: buffer,
        bold: state.bold,
        italic: state.italic,
        underline: state.underline,
        size: state.size,
      });
      buffer = '';
    }
  };
  const endParagraph = () => {
    pushRun();
    if (runs.length) blocks.push({ runs, heading: 0 });
    runs = [];
  };

  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];

    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (!state.skip) buffer += next;
        i++;
        continue;
      }
      // "\*" marks the whole group as ignorable (\*\expandedcolortbl, \*\themedata…).
      if (next === '*') {
        state.skip = true;
        i++;
        continue;
      }
      // A backslash before a line break is a paragraph mark. TextEdit, Pages
      // and macOS textutil all write paragraphs this way instead of \par.
      if (next === '\n' || next === '\r') {
        if (!state.skip) endParagraph();
        i++;
        continue;
      }
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        i += 3;
        if (pendingSkip > 0) {
          pendingSkip--;
          continue;
        }
        if (!state.skip) {
          buffer += decoder.decode(new Uint8Array([parseInt(hex, 16) || 0]));
        }
        continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i + 1));
      if (!m) {
        i++;
        continue;
      }
      const word = m[1];
      const param = m[2] === undefined ? null : Number(m[2]);
      i += m[0].length;

      if (pendingSkip > 0 && word !== 'u') {
        pendingSkip--;
        continue;
      }

      if (SKIP_DESTINATIONS.has(word)) {
        state.skip = true;
        continue;
      }
      switch (word) {
        case 'ansicpg':
          codepage = param || 1252;
          try {
            decoder = new TextDecoder(codepage === 65001 ? 'utf-8' : `windows-${codepage}`);
          } catch {
            decoder = new TextDecoder('windows-1252');
          }
          break;
        case 'uc':
          unicodeSkip = param ?? 1;
          break;
        case 'u': {
          if (!state.skip && param !== null) {
            const code = param < 0 ? param + 65536 : param;
            buffer += String.fromCharCode(code);
          }
          pendingSkip = unicodeSkip;
          break;
        }
        // Text buffered so far belongs to the *previous* style, so flush first.
        case 'b': pushRun(); state.bold = param !== 0; break;
        case 'i': pushRun(); state.italic = param !== 0; break;
        case 'ul': pushRun(); state.underline = param !== 0; break;
        case 'ulnone': pushRun(); state.underline = false; break;
        case 'plain':
          pushRun();
          state.bold = state.italic = state.underline = false;
          break;
        case 'fs': pushRun(); state.size = param ?? 0; break;
        case 'par':
        case 'pard':
          if (word === 'par') {
            if (!state.skip) endParagraph();
          }
          break;
        default:
          if (SPECIALS[word] && !state.skip) buffer += SPECIALS[word];
      }
      continue;
    }

    if (ch === '{') {
      stack.push({ ...state });
      pushRun();
      continue;
    }
    if (ch === '}') {
      pushRun();
      state = stack.pop() || { bold: false, italic: false, underline: false, size: 0, skip: false };
      continue;
    }
    if (ch === '\n' || ch === '\r') continue;
    if (pendingSkip > 0) {
      pendingSkip--;
      continue;
    }
    if (!state.skip) buffer += ch;
  }
  endParagraph();
  return promoteHeadings(blocks);
}

/**
 * RTF has no heading concept — Word writes them as larger, bolder runs. A short
 * paragraph set noticeably larger than the body size is treated as a heading.
 */
function promoteHeadings(blocks) {
  const sizes = [];
  for (const block of blocks) {
    for (const run of block.runs) {
      const weight = Math.max(1, Math.ceil(run.text.length / 4));
      if (run.size) for (let i = 0; i < weight; i++) sizes.push(run.size);
    }
  }
  if (!sizes.length) return blocks;
  sizes.sort((a, b) => a - b);
  const body = sizes[sizes.length >> 1];

  return blocks.map((block) => {
    const text = block.runs.map((r) => r.text).join('').trim();
    const size = Math.max(0, ...block.runs.map((r) => r.size || 0));
    if (!text || text.length > 120 || !size) return block;
    const ratio = size / body;
    let heading = 0;
    if (ratio >= 1.8) heading = 1;
    else if (ratio >= 1.45) heading = 2;
    else if (ratio >= 1.2) heading = 3;
    else if (ratio >= 1.08 && block.runs.every((r) => r.bold)) heading = 4;
    return { ...block, heading };
  });
}
