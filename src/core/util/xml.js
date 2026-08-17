/**
 * XML helpers for the OOXML / OpenDocument / EPUB adapters.
 *
 * Prefixes (`w:`, `a:`, `p:`) are conventional but not guaranteed, so every
 * lookup tries the literal qualified name first and falls back to a
 * namespace-agnostic local-name match.
 */

export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`Malformed XML: ${err.textContent.slice(0, 200)}`);
  return doc;
}

export function parseHtmlDoc(text) {
  return new DOMParser().parseFromString(text, 'text/html');
}

const local = (qname) => (qname.includes(':') ? qname.split(':').pop() : qname);

export function findAll(root, qname) {
  if (!root) return [];
  const direct = root.getElementsByTagName(qname);
  if (direct.length) return Array.from(direct);
  return Array.from(root.getElementsByTagNameNS('*', local(qname)));
}

export function findFirst(root, qname) {
  return findAll(root, qname)[0] || null;
}

/** Direct children only — important when nested structures share a tag name. */
export function childrenNamed(node, qname) {
  if (!node) return [];
  const want = local(qname);
  return Array.from(node.children).filter(
    (c) => c.tagName === qname || c.localName === want
  );
}

export function attr(node, qname, dflt = null) {
  if (!node) return dflt;
  const direct = node.getAttribute(qname);
  if (direct !== null) return direct;
  const want = local(qname);
  for (const a of node.attributes) {
    if (a.localName === want || a.name === want) return a.value;
  }
  return dflt;
}

export function textOf(node) {
  return node ? node.textContent : '';
}
