/** Sanitized fragment -> a standalone, self-contained HTML5 document. */

import { escapeHtml } from '../util/misc.js';

const STYLE = `
:root{color-scheme:light dark;--fg:#1a1a1a;--bg:#fff;--muted:#5c5c5c;--rule:#e2e2e2;--accent:#0b57d0;--code-bg:#f5f5f7}
@media (prefers-color-scheme:dark){:root{--fg:#e8e8e8;--bg:#151517;--muted:#a0a0a8;--rule:#33333a;--accent:#8ab4f8;--code-bg:#1f1f24}}
*{box-sizing:border-box}
body{margin:0 auto;padding:2.5rem 1.25rem 6rem;max-width:46rem;background:var(--bg);color:var(--fg);
font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:2em 0 .6em;font-weight:650}
h1{font-size:2em;margin-top:0}h2{font-size:1.5em}h3{font-size:1.22em}h4{font-size:1.05em}
p,ul,ol,blockquote,table,pre{margin:0 0 1.1em}
a{color:var(--accent)}
img{max-width:100%;height:auto;border-radius:4px}
blockquote{margin-left:0;padding:.2em 1em;border-left:3px solid var(--rule);color:var(--muted)}
code{background:var(--code-bg);padding:.15em .35em;border-radius:4px;font-size:.9em;
font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre{background:var(--code-bg);padding:1em;border-radius:8px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}
th,td{border:1px solid var(--rule);padding:.45em .7em;text-align:left;vertical-align:top}
th{background:var(--code-bg);font-weight:600}
hr{border:0;border-top:1px solid var(--rule);margin:2em 0}
figcaption{color:var(--muted);font-size:.9em}
.mdf-meta{color:var(--muted);font-size:.85em;border-bottom:1px solid var(--rule);padding-bottom:1rem;margin-bottom:2rem}
[data-smc-review]{margin-left:.3em;color:#b45309;cursor:help}
@media (prefers-color-scheme:dark){[data-smc-review]{color:#e0b050}}
`;

export function toStandaloneHtml(html, opts, meta = {}) {
  const title = meta.title || meta.name || 'Converted document';
  // The marker text lives in the attribute; surface it as a tooltip so the HTML
  // reader gets the same warning the Markdown reader gets from the comment.
  const body = html.replace(
    /<span data-smc-review="([^"]*)"/g,
    (m, reason) => `<span data-smc-review="${reason}" title="${reason}"`
  );
  const bits = [
    meta.author && `by ${meta.author}`,
    meta.kind && `from ${meta.kind.toUpperCase()}`,
    meta.pages && `${meta.pages} pages`,
    meta.converted && `converted ${meta.converted.slice(0, 10)}`,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="${escapeHtml(meta.language || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="generator" content="${escapeHtml(meta.generator || 'Sumcheck')}">
${meta.source ? `<link rel="canonical" href="${escapeHtml(meta.source)}">` : ''}
${meta.author ? `<meta name="author" content="${escapeHtml(meta.author)}">` : ''}
<style>${STYLE}</style>
</head>
<body>
${bits.length ? `<p class="mdf-meta">${escapeHtml(bits.join(' · '))}</p>` : ''}
${body}
</body>
</html>
`;
}
