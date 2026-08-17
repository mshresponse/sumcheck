/**
 * Nested list assembly.
 *
 * A nested <ul> must live *inside* the preceding <li>, not beside it. Emitting
 * `<ul><li>a</li><ul><li>b</li></ul></ul>` is invalid, and the HTML parser
 * hoists it back to a flat list — which is exactly how indentation gets lost
 * on the way to Markdown.
 */

/**
 * @param {{level:number, html:string}[]} items
 * @param {boolean} ordered
 */
export function buildNestedList(items, ordered) {
  if (!items.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  let out = `<${tag}>`;
  let depth = 0;

  for (const item of items) {
    const level = Math.max(0, Math.min(item.level ?? 0, depth + 1));
    while (depth < level) {
      // Re-enter the previous <li> so the sublist nests inside it.
      if (out.endsWith('</li>')) out = out.slice(0, -'</li>'.length);
      out += `<${tag}>`;
      depth++;
    }
    while (depth > level) {
      out += `</${tag}></li>`;
      depth--;
    }
    out += `<li>${item.html}</li>`;
  }
  while (depth > 0) {
    out += `</${tag}></li>`;
    depth--;
  }
  return `${out}</${tag}>`;
}
