/**
 * Prose lexicon: catching OCR errors the confidence score is happy with.
 *
 * Confidence answers "how sure was the engine", which is a different question
 * from "is that a word". The `fast` language pack reads "included" as
 * "inchided" at 55-66% — flagged — but nothing stops a pack from being *sure*
 * about a non-word, and a reader skimming a converted document has no way to
 * tell a confident error from a correct reading. So the check here runs
 * regardless of confidence: a token that is not a word, and that sits within
 * two edits of a common one, gets a marker naming what it probably should be.
 *
 * It suggests. It never rewrites. A converter that silently "corrects" a
 * medical document is worse than one that is visibly unsure.
 *
 * The hard part is not detection, it is silence on correct text. This runs over
 * clinical documents full of words a small dictionary has never met —
 * `appendicular`, `radiopharmaceutical`, `parotid` — and one false alarm per
 * document would teach people to ignore the marker layer entirely. Everything
 * in `isCandidate` exists to buy that silence, and each rule is there because
 * it fired on the real corpus:
 *
 *   ALL CAPS        procedure descriptors, never prose
 *   internal capital  `TaxID` — an identifier or a run-together, not a word
 *   no vowel        `Blvd` — an abbreviation
 *   mid-sentence capital  `Richmond`, `Trenton` — proper nouns, which no
 *                   dictionary can adjudicate; sentence-initial words are
 *                   still checked
 *   digits          codes, dates, amounts — the value validators own those
 *
 * Measured on 50 real scanned estimates: 50/50 `inchided` caught, zero correct
 * words flagged, and zero flags of any kind on the same corpus converted with
 * the pack that reads "included" correctly.
 */

import { vendorUrl } from './vendor.js';

/** The shortest token worth judging. Below this, edit distance is noise. */
const MIN_LENGTH = 4;
/** How far a real word can drift and still be recognisable as itself. */
const MAX_EDITS = 2;

let lexiconPromise = null;

/**
 * Load the two word lists. Both are needed and they answer different
 * questions: `english` decides whether a token is a word at all, `common`
 * decides what a non-word probably meant. Frequency order in `common` is
 * load-bearing — "inchided" is exactly two edits from both "included" and
 * "inclined", and only frequency picks the right one.
 */
export function loadLexicon() {
  if (!lexiconPromise) {
    lexiconPromise = (async () => {
      const [englishText, commonText] = await Promise.all([
        fetch(vendorUrl('wordlist/english.txt')).then((r) => r.text()),
        fetch(vendorUrl('wordlist/common.txt')).then((r) => r.text()),
      ]);
      const known = new Set(englishText.split('\n').filter(Boolean));
      // Bucketed by length so a lookup only compares words that could be
      // within two edits, which is the difference between a scan of 9k words
      // and a scan of a few hundred.
      const byLength = new Map();
      for (const word of commonText.split('\n')) {
        if (!word) continue;
        if (!byLength.has(word.length)) byLength.set(word.length, []);
        byLength.get(word.length).push(word);
      }
      return { known, byLength };
    })().catch((err) => {
      lexiconPromise = null; // a failed load must not poison later runs
      throw err;
    });
  }
  return lexiconPromise;
}

/** Test seam: drop the cached lists so a test can load them again. */
export function resetLexicon() {
  lexiconPromise = null;
}

/**
 * Levenshtein distance, abandoned as soon as every path exceeds `max`. The
 * early exit is what makes this affordable to run over every prose token.
 */
export function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (current[j] < best) best = current[j];
    }
    if (best > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

/**
 * Is this token the sort of thing a dictionary can judge at all?
 *
 * @param {string} token      the word as written
 * @param {boolean} sentenceInitial  whether it opens a sentence
 */
export function isCandidate(token, sentenceInitial) {
  if (token.length < MIN_LENGTH) return false;
  if (!/^[A-Za-z]+$/.test(token)) return false;
  if (token === token.toUpperCase()) return false;
  if (/[A-Z]/.test(token.slice(1))) return false;
  if (!/[aeiouy]/i.test(token)) return false;
  if (/^[A-Z]/.test(token) && !sentenceInitial) return false;
  return true;
}

/**
 * What a non-word probably should have been, or null to stay quiet.
 *
 * Distance 1 is searched before distance 2 across the whole list, so a
 * one-edit neighbour always wins over a two-edit one however common it is.
 */
export function suggestionFor(token, lexicon) {
  const lower = token.toLowerCase();
  if (lexicon.known.has(lower)) return null;
  for (let distance = 1; distance <= MAX_EDITS; distance++) {
    for (let length = lower.length - distance; length <= lower.length + distance; length++) {
      for (const word of lexicon.byLength.get(length) || []) {
        if (word !== lower && editDistanceWithin(lower, word, distance)) return word;
      }
    }
  }
  return null;
}
