/**
 * Structural validators.
 *
 * OCR confidence catches loud failures. It does not catch confident ones: a "$"
 * misread as "3" produces `340.00`, which scores well because "340.00" is a
 * perfectly good number. The checks here are deterministic, engine-independent,
 * and aimed exactly at the wrong-but-plausible cases:
 *
 *   - a bare amount sitting among "$"-prefixed siblings
 *   - line items that do not sum to their stated total
 *
 * Nothing here rewrites a value. On a price list, a converter that silently
 * "corrects" figures is worse than one that gets them wrong loudly.
 */

import { loadLexicon, isCandidate, suggestionFor } from './lexicon.js';

const MONEY = /^\$\s?-?[\d,]+\.\d{2}$/;
const BARE_MONEY = /^-?[\d,]+\.\d{2}$/;
const TOTAL_ROW = /\b(total|amount due|balance|subtotal|grand total)\b/i;

/** Digits a "$" is commonly misread as once its vertical stroke is lost. */
const SIGIL_CONFUSIONS = new Set(['3', '5', '8', '9', 'S', 'B']);

export async function validateDocument(host, { markers = true, ocr = false } = {}) {
  const flags = [];
  for (const table of host.querySelectorAll('table')) {
    checkCurrencyColumns(table, flags);
    checkTotals(table, flags);
  }
  checkHeadlineAgainstTotals(host, flags);
  // Only OCR'd text can contain OCR misreadings, and loading ~1 MB of word
  // lists to check a Word document nobody scanned would be pure cost.
  if (ocr) await checkProseLexicon(host, flags);
  if (markers) {
    for (const flag of flags) attachMarker(flag);
  }
  return flags.map(({ node, ...rest }) => rest);
}

/**
 * Elements whose text is not prose: values the other validators already own,
 * verbatim blocks, and link text where a URL's parts are not English.
 */
const NOT_PROSE = 'table, pre, code, a';

/** A line carrying a procedure code and its descriptor, e.g. "77081 - DUAL…". */
const CODE_DESCRIPTOR = /\b\d{4,5}\s*-\s*\S/;

/**
 * Flag prose tokens that are not words but are one or two edits from a common
 * one. See `lexicon.js` for why each exclusion exists; every one of them was
 * added because it fired on correct text in the real corpus.
 */
async function checkProseLexicon(host, flags) {
  let lexicon;
  try {
    lexicon = await loadLexicon();
  } catch {
    // A missing word list must not fail the conversion. The document still
    // converts; it just does not get this particular second opinion.
    return;
  }

  const walker = host.ownerDocument.createTreeWalker(host, 4 /* SHOW_TEXT */);
  const seen = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(NOT_PROSE)) continue;
    const text = node.nodeValue || '';
    if (!text.trim() || CODE_DESCRIPTOR.test(text)) continue;

    const pattern = /[A-Za-z][A-Za-z'’-]*/g;
    let match;
    while ((match = pattern.exec(text))) {
      const token = match[0].replace(/^['’-]+|['’-]+$/g, '');
      const before = text.slice(0, match.index).replace(/\s+$/, '');
      const sentenceInitial = before === '' || /[.!?:;]$/.test(before);
      if (!isCandidate(token, sentenceInitial)) continue;
      const suggestion = suggestionFor(token, lexicon);
      if (!suggestion) continue;
      // One flag per distinct word: the disclaimer repeats, and so would the
      // marker.
      if (seen.has(token)) continue;
      seen.add(token);
      flags.push({
        node: parent,
        kind: 'not-a-word',
        message: `"${token}" is not a recognised word — it may be "${suggestion}"`,
      });
    }
  }
}

const cellText = (cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim();

function tableGrid(table) {
  return Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children));
}

/**
 * A column where some cells carry "$" and others do not is the signature of a
 * dropped sigil — and the dropped character usually merges into the number,
 * inflating it by roughly an order of magnitude while still looking valid.
 */
function checkCurrencyColumns(table, flags) {
  const grid = tableGrid(table);
  if (grid.length < 2) return;
  const width = Math.max(...grid.map((row) => row.length));

  for (let col = 0; col < width; col++) {
    const cells = grid.map((row) => row[col]).filter(Boolean);
    const amounts = cells.filter((c) => MONEY.test(cellText(c)));
    if (amounts.length < 2) continue;

    for (const cell of cells) {
      const text = cellText(cell);
      if (!BARE_MONEY.test(text)) continue;
      const lead = text[0];
      const hint = SIGIL_CONFUSIONS.has(lead)
        ? `"${text}" may be "$${text.slice(1)}" with the "$" misread as "${lead}"`
        : `"${text}" has no "$" while other amounts in this column do`;
      flags.push({
        type: 'currency-sigil',
        text,
        message: hint,
        node: cell,
      });
    }
  }
}

/** Line items must sum to the total row. One rule, and it needs no engine. */
function checkTotals(table, flags) {
  const grid = tableGrid(table);
  if (grid.length < 3) return;
  const width = Math.max(...grid.map((row) => row.length));

  for (let col = 0; col < width; col++) {
    const rows = grid
      .map((row) => ({ cell: row[col], label: row[0] ? cellText(row[0]) : '' }))
      .filter((r) => r.cell);
    const parsed = rows.map((r) => ({ ...r, value: parseMoney(cellText(r.cell)) }));
    const totalRow = parsed.find((r) => TOTAL_ROW.test(r.label) && r.value !== null);
    if (!totalRow) continue;

    const items = parsed.filter((r) => r !== totalRow && r.value !== null);
    if (items.length < 2) continue;

    const sum = items.reduce((a, r) => a + r.value, 0);
    if (Math.abs(sum - totalRow.value) <= 0.01) continue;

    flags.push({
      type: 'total-mismatch',
      text: cellText(totalRow.cell),
      message:
        `line items sum to ${format(sum)} but the total row says ${format(totalRow.value)} ` +
        `(off by ${format(Math.abs(sum - totalRow.value))})`,
      node: totalRow.cell,
    });
  }
}

/**
 * A figure standing on its own, in the most prominent position on the page,
 * that contradicts every total the document states.
 *
 * OCR recovers headline figures from regions the first pass could not read, at
 * middling confidence and with nothing else to check them against — except that
 * the same number is usually printed again in the totals row. When those two
 * disagree, one of them is wrong, and the prominent one is the dangerous one.
 * Flagged, never reconciled: choosing a winner would be rewriting a value.
 */
function checkHeadlineAgainstTotals(host, flags) {
  const standalone = [];
  const stated = [];

  // A headline is a heading or a paragraph that is nothing but an amount. Cells
  // are deliberately excluded: a column of figures is not a headline, and the
  // column and total checks already cover those.
  for (const node of host.querySelectorAll('h1, h2, h3, h4, h5, h6, p')) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const value = text ? parseMoney(text) : null;
    if (value !== null && /^[$\d]/.test(text)) standalone.push({ node, value, text });
  }

  // `tr` matters: in a table the word "Total" and its amount sit in different
  // cells, so only the row's combined text states the total.
  for (const node of host.querySelectorAll('p, tr, li')) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/\btotals?\b/i.test(text)) continue;
    for (const match of text.match(/\$\s?-?[\d,]+\.\d{2}/g) || []) {
      const parsed = parseMoney(match.trim());
      if (parsed !== null) stated.push(parsed);
    }
  }

  if (!standalone.length || !stated.length) return;
  for (const candidate of standalone) {
    if (stated.some((total) => Math.abs(total - candidate.value) <= 0.01)) continue;
    flags.push({
      type: 'headline-total-mismatch',
      text: candidate.text,
      message:
        `the headline figure ${format(candidate.value)} matches none of the totals stated ` +
        `elsewhere on the page (${[...new Set(stated)].map(format).join(', ')})`,
      node: candidate.node,
    });
  }
}

function parseMoney(text) {
  if (!MONEY.test(text) && !BARE_MONEY.test(text)) return null;
  const value = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(value) ? value : null;
}

const format = (n) => `$${n.toFixed(2)}`;

/**
 * The glyph is load-bearing: Turndown replaces empty elements with nothing
 * before any rule sees them, so a marker with no content silently disappears
 * from the Markdown. It also gives the HTML and plain-text outputs something
 * visible to show.
 */
export const REVIEW_GLYPH = '⚠';

function attachMarker(flag) {
  const marker = flag.node.ownerDocument.createElement('span');
  marker.setAttribute('data-smc-review', flag.message);
  marker.textContent = REVIEW_GLYPH;
  flag.node.appendChild(marker);
}
