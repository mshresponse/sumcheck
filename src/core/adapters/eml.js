/**
 * Email (.eml) and saved web archives (.mhtml/.mht) -> HTML.
 *
 * Both are RFC 2045 MIME containers, so one parser covers them: walk the
 * multipart tree, decode transfer encodings, and pick the richest body part.
 */

import { escapeHtml, decodeText, bytesToDataUrl } from '../util/misc.js';
import { convertHtmlString } from './html.js';

export async function convertEml(bytes, ctx) {
  const raw = decodeText(bytes.buffer ?? bytes, 'utf-8');
  const message = parseMessage(raw);
  const headers = message.headers;

  const body = pickBody(message);
  const warnings = [];
  let bodyHtml = '';

  if (body?.type === 'text/html') {
    const cleaned = await convertHtmlString(body.text, { opts: { ...ctx.opts, readability: false } });
    bodyHtml = cleaned.html;
    warnings.push(...cleaned.warnings);
  } else if (body) {
    bodyHtml = body.text
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  } else {
    warnings.push('No readable body part was found in this message.');
  }

  const attachments = collectAttachments(message);
  const rows = [
    ['From', headers.from],
    ['To', headers.to],
    ['Cc', headers.cc],
    ['Date', headers.date],
    ['Subject', headers.subject],
  ].filter(([, v]) => v);

  const head = [
    `<h1>${escapeHtml(headers.subject || '(no subject)')}</h1>`,
    '<table><tbody>',
    rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join(''),
    '</tbody></table>',
  ].join('');

  const tail = attachments.length
    ? `<h2>Attachments</h2><ul>${attachments
        .map((a) => `<li>${escapeHtml(a.name)} <em>(${a.type})</em></li>`)
        .join('')}</ul>`
    : '';

  return {
    html: [head, bodyHtml, tail].filter(Boolean).join('\n'),
    warnings,
    meta: {
      kind: 'eml',
      title: headers.subject,
      author: headers.from,
      created: headers.date,
      attachments: attachments.length,
    },
  };
}

export async function convertMhtml(bytes, ctx) {
  const raw = decodeText(bytes.buffer ?? bytes, 'utf-8');
  const message = parseMessage(raw);
  const parts = flatten(message);
  const htmlPart = parts.find((p) => p.type === 'text/html');
  if (!htmlPart) throw new Error('This archive contains no HTML part.');

  // Rewire cid: references to the inline resources stored alongside.
  const byId = new Map();
  for (const part of parts) {
    const cid = (part.headers['content-id'] || '').replace(/[<>]/g, '');
    if (cid && part.bytes) byId.set(cid, bytesToDataUrl(part.bytes, part.type));
    if (part.headers['content-location'] && part.bytes) {
      byId.set(part.headers['content-location'], bytesToDataUrl(part.bytes, part.type));
    }
  }
  let html = htmlPart.text.replace(/(src|href)=(["'])(cid:)?([^"']+)\2/gi, (match, attr, q, cid, ref) => {
    const hit = byId.get(ref) || byId.get(decodeURIComponent(ref));
    return hit ? `${attr}=${q}${hit}${q}` : match;
  });

  const converted = await convertHtmlString(
    html,
    ctx,
    // Chrome writes the page's own address as Snapshot-Content-Location.
    message.headers['snapshot-content-location'] ||
      message.headers['content-location'] ||
      htmlPart.headers['content-location']
  );
  return { ...converted, meta: { ...converted.meta, kind: 'mhtml' } };
}

/* ------------------------------------------------------------------ parse */

function parseMessage(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const split = normalized.indexOf('\n\n');
  const headerText = split === -1 ? normalized : normalized.slice(0, split);
  const bodyText = split === -1 ? '' : normalized.slice(split + 2);
  const headers = parseHeaders(headerText);
  return buildPart(headers, bodyText);
}

function parseHeaders(text) {
  const headers = {};
  const unfolded = text.replace(/\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\n')) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (m) headers[m[1].toLowerCase()] = decodeWords(m[2].trim());
  }
  return headers;
}

function buildPart(headers, bodyText) {
  const contentType = headers['content-type'] || 'text/plain';
  const type = contentType.split(';')[0].trim().toLowerCase();
  const charset = /charset="?([^";]+)"?/i.exec(contentType)?.[1];
  const encoding = (headers['content-transfer-encoding'] || '7bit').toLowerCase();

  const part = { headers, type, charset, encoding, children: [], subject: headers.subject };
  part.from = headers.from;

  if (type.startsWith('multipart/')) {
    const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
    if (boundary) {
      for (const chunk of splitBoundary(bodyText, boundary)) {
        const split = chunk.indexOf('\n\n');
        const childHeaders = parseHeaders(split === -1 ? chunk : chunk.slice(0, split));
        const childBody = split === -1 ? '' : chunk.slice(split + 2);
        part.children.push(buildPart(childHeaders, childBody));
      }
    }
    return part;
  }

  const decoded = decodeBody(bodyText, encoding);
  part.bytes = decoded;
  part.text = new TextDecoder(safeCharset(charset)).decode(decoded);
  return part;
}

function safeCharset(charset) {
  if (!charset) return 'utf-8';
  try {
    new TextDecoder(charset);
    return charset;
  } catch {
    return 'utf-8';
  }
}

function splitBoundary(body, boundary) {
  const marker = `--${boundary}`;
  const chunks = [];
  const lines = body.split('\n');
  let current = null;
  for (const line of lines) {
    if (line.trimEnd() === marker) {
      if (current !== null) chunks.push(current.join('\n'));
      current = [];
      continue;
    }
    if (line.trimEnd() === `${marker}--`) {
      if (current !== null) chunks.push(current.join('\n'));
      current = null;
      break;
    }
    if (current !== null) current.push(line);
  }
  if (current !== null && current.length) chunks.push(current.join('\n'));
  return chunks.filter((c) => c.trim());
}

function decodeBody(text, encoding) {
  if (encoding === 'base64') {
    const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
    try {
      const binary = atob(clean);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    } catch {
      return new TextEncoder().encode(text);
    }
  }
  if (encoding === 'quoted-printable') {
    const joined = text.replace(/=\n/g, '');
    const out = [];
    for (let i = 0; i < joined.length; i++) {
      if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
        out.push(parseInt(joined.slice(i + 1, i + 3), 16));
        i += 2;
      } else out.push(joined.charCodeAt(i) & 0xff);
    }
    return new Uint8Array(out);
  }
  return new TextEncoder().encode(text);
}

/** RFC 2047 encoded words, e.g. =?utf-8?B?SGVsbG8=?= */
function decodeWords(value) {
  return value.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (match, charset, mode, data) => {
    try {
      let bytes;
      if (mode.toUpperCase() === 'B') {
        const binary = atob(data);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } else {
        bytes = decodeBody(data.replace(/_/g, ' '), 'quoted-printable');
      }
      return new TextDecoder(safeCharset(charset)).decode(bytes);
    } catch {
      return match;
    }
  });
}

function flatten(part, out = []) {
  out.push(part);
  for (const child of part.children) flatten(child, out);
  return out;
}

function pickBody(message) {
  const parts = flatten(message).filter((p) => !p.children.length);
  const inline = parts.filter((p) => !/attachment/i.test(p.headers['content-disposition'] || ''));
  return (
    inline.find((p) => p.type === 'text/html') ||
    inline.find((p) => p.type === 'text/plain') ||
    parts.find((p) => p.type?.startsWith('text/')) ||
    null
  );
}

function collectAttachments(message) {
  return flatten(message)
    .filter((p) => /attachment/i.test(p.headers['content-disposition'] || ''))
    .map((p) => ({
      name:
        /filename="?([^";]+)"?/i.exec(p.headers['content-disposition'] || '')?.[1] ||
        /name="?([^";]+)"?/i.exec(p.headers['content-type'] || '')?.[1] ||
        'attachment',
      type: p.type,
    }));
}
