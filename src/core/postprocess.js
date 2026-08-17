/**
 * Structure repair for documents that only *look* structured.
 *
 * Plenty of real .docx/.rtf/.odt files — anything exported from Pages, Google
 * Docs, textutil, or written by someone who styles by hand — have no heading
 * styles and no list numbering. They have bold paragraphs and lines that start
 * with "•". Word renders that fine; a semantic converter sees flat paragraphs.
 *
 * This pass recovers the intent: bullet-prefixed paragraph runs become lists,
 * and short standalone bold paragraphs become headings.
 */

import { buildNestedList } from './util/lists.js';

const UNORDERED_RE = /^[ \t\u00A0]*([•·▪◦‣∙◾▸►])[ \t\u00A0]+/;
const DASH_RE = /^[ \t\u00A0]*[-–—*][ \t\u00A0]+/;
const ORDERED_RE = /^[ \t\u00A0]*\(?(\d{1,3}|[a-zA-Z])[.)][ \t\u00A0]+/;

/** Formats whose source carries real structure never come through here. */
export const REPAIRABLE_KINDS = new Set(['docx', 'rtf', 'odt', 'odp', 'text', 'eml', 'mhtml']);

export function repairStructure(host) {
  promoteBoldParagraphs(host);
  groupListParagraphs(host);
}

/* ------------------------------------------------------------------ lists */

function groupListParagraphs(host) {
  const children = Array.from(host.children);
  let i = 0;
  while (i < children.length) {
    const marker = markerOf(children[i]);
    if (!marker) {
      i++;
      continue;
    }
    let j = i;
    const run = [];
    while (j < children.length) {
      const next = markerOf(children[j]);
      if (!next || next.ordered !== marker.ordered) break;
      run.push({ node: children[j], marker: next });
      j++;
    }
    // A lone "- something" paragraph is more likely a dash than a list, unless
    // it is a real bullet glyph.
    if (run.length < 2 && !marker.glyph) {
      i = j;
      continue;
    }

    const items = run.map(({ node, marker: m }) => ({
      level: m.level,
      html: stripMarker(node, m.length),
    }));
    const list = host.ownerDocument.createElement('div');
    list.innerHTML = buildNestedList(items, marker.ordered);
    run[0].node.replaceWith(list.firstChild);
    for (const { node } of run.slice(1)) node.remove();
    i = j;
  }
}

function markerOf(node) {
  if (!node || node.tagName !== 'P') return null;
  const text = node.textContent || '';
  const indent = /^[ \t\u00A0]*/.exec(text)[0].length;
  const level = Math.min(3, Math.floor(indent / 2));

  let m = UNORDERED_RE.exec(text);
  if (m) return { ordered: false, length: m[0].length, level, glyph: true };
  m = ORDERED_RE.exec(text);
  if (m && text.length > m[0].length + 1) return { ordered: true, length: m[0].length, level, glyph: false };
  m = DASH_RE.exec(text);
  if (m && text.length > m[0].length + 1) return { ordered: false, length: m[0].length, level, glyph: false };
  return null;
}

/** Remove the leading marker characters while preserving inline markup. */
function stripMarker(node, count) {
  const clone = node.cloneNode(true);
  let remaining = count;
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const doomed = [];
  let textNode = walker.nextNode();
  while (textNode && remaining > 0) {
    const value = textNode.nodeValue;
    if (value.length <= remaining) {
      remaining -= value.length;
      doomed.push(textNode);
    } else {
      textNode.nodeValue = value.slice(remaining);
      remaining = 0;
    }
    textNode = walker.nextNode();
  }
  for (const n of doomed) n.remove();
  return clone.innerHTML.trim();
}

/* --------------------------------------------------------------- headings */

function promoteBoldParagraphs(host) {
  for (const node of Array.from(host.children)) {
    if (node.tagName !== 'P') continue;
    const text = (node.textContent || '').trim();
    if (!text || text.length > 90) continue;
    if (/[.,;:]$/.test(text)) continue;
    if (markerOf(node)) continue;

    // The paragraph must be *entirely* bold — a bold lead-in inside a sentence
    // is not a heading.
    const bold = node.querySelector(':scope > strong, :scope > b');
    if (!bold) continue;
    if (bold.textContent.trim() !== text) continue;

    const heading = host.ownerDocument.createElement('h2');
    heading.innerHTML = bold.innerHTML;
    node.replaceWith(heading);
  }
}
