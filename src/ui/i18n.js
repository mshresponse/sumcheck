/**
 * User-interface strings.
 *
 * Two runtimes have to work. Installed, `chrome.i18n.getMessage` resolves
 * against `_locales/` and honours the browser's language. Under the dev server
 * — which is how `npm test` and the harness exercise every one of these pages —
 * there is no `chrome` object at all, so the same catalogue is fetched and read
 * directly. Without the fallback every string in the suite would render empty,
 * and the tests would be asserting against a UI no user ever sees.
 *
 * Scope is deliberately the UI only. Everything under `src/core/` — conversion
 * warnings, `SUMCHECK:` review markers, front-matter keys, the `generator` line
 * — is product output that ships *inside* converted documents, and stays
 * English regardless of the reader's browser language. A document's contents
 * should not depend on the locale of whoever converted it.
 */

let table = null;

/**
 * Load the catalogue if this runtime needs one. Safe to call more than once,
 * and a no-op where `chrome.i18n` is available.
 */
export async function initI18n() {
  if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) return;
  if (table) return;
  try {
    const url = new URL('../../_locales/en/messages.json', import.meta.url);
    const json = await (await fetch(url)).json();
    table = Object.fromEntries(Object.entries(json).map(([key, entry]) => [key, entry.message]));
  } catch {
    // A missing catalogue must not blank the interface; t() falls back to the
    // key, which is ugly but legible and obviously wrong rather than invisible.
    table = {};
  }
}

/**
 * Look up a message, substituting `$1`…`$9`.
 *
 * @param {string} key
 * @param {...(string|number)} substitutions
 */
export function t(key, ...substitutions) {
  let message;
  if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
    message = chrome.i18n.getMessage(key, substitutions.map(String));
    // getMessage returns '' for an unknown key, which would silently blank the
    // element it was destined for.
    if (message) return message;
  }
  message = table?.[key];
  if (message === undefined) return key;
  return message.replace(/\$([1-9])/g, (whole, index) => {
    const value = substitutions[Number(index) - 1];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Apply the catalogue to a document.
 *
 * `data-i18n` sets text content. `data-i18n-attr` sets attributes, as a
 * comma-separated `attribute:key` list — `title`, `aria-label` and `placeholder`
 * are all user-visible and all easy to forget.
 */
export function localizeDocument(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const [attribute, key] = pair.split(':').map((s) => s.trim());
      if (attribute && key) node.setAttribute(attribute, t(key));
    }
  }
  /**
   * A sentence with one emphasised word inside it. The whole sentence is a
   * single message carrying a `$1`, so a translator gets real word order
   * instead of three fragments to reassemble. Built with DOM nodes, never
   * innerHTML.
   */
  for (const node of root.querySelectorAll('[data-i18n-emphasis]')) {
    const [sentenceKey, wordKey] = node.dataset.i18nEmphasis.split(':');
    const [before, after = ''] = t(sentenceKey).split('$1');
    const em = root.ownerDocument ? root.ownerDocument.createElement('em') : document.createElement('em');
    em.textContent = t(wordKey);
    node.replaceChildren(document.createTextNode(before), em, document.createTextNode(after));
  }

  const title = root.querySelector('title[data-i18n-title]');
  if (title) title.textContent = t(title.dataset.i18nTitle);
}
