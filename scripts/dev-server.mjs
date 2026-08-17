#!/usr/bin/env node
/**
 * Static server for local development and the test harness.
 *
 * It sends the *same* Content-Security-Policy the extension runs under, so a
 * page that works here works after `Load unpacked` — no surprises about
 * blocked wasm, blob workers or inline script.
 *
 *   node scripts/dev-server.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8931;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.bcmap': 'application/octet-stream',
};

// Mirrors manifest.json's content_security_policy.extension_pages.
const CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; child-src 'self'";

const CORPUS = process.env.SUMCHECK_CORPUS || null;

function serve(file, res) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const rel = decodeURIComponent(url.pathname);
    if (rel === '/') {
      // Redirect rather than serve, so the page's relative URLs still resolve.
      res.writeHead(302, { Location: '/test/harness.html' }).end();
      return;
    }

    // An audit corpus is mounted read-only and never copied anywhere. Point
    // SUMCHECK_CORPUS at a directory of documents to run scripts/audit.mjs
    // against files that should not be moved (or that contain personal data).
    if (rel === '/corpus-list.json') {
      const files = CORPUS
        ? fs.readdirSync(CORPUS).filter((f) => /\.(pdf|png|jpe?g|tiff?)$/i.test(f)).sort()
        : [];
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Security-Policy': CSP });
      res.end(JSON.stringify(files));
      return;
    }
    if (rel.startsWith('/corpus/')) {
      if (!CORPUS) {
        res.writeHead(404).end('no corpus mounted (set SUMCHECK_CORPUS)');
        return;
      }
      const name = path.basename(decodeURIComponent(rel.slice('/corpus/'.length)));
      serve(path.join(CORPUS, name), res);
      return;
    }

    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    serve(file, res);
  })
  .listen(PORT, () => {
    console.log(`Sumcheck dev server: http://localhost:${PORT}/`);
    console.log(`  test harness  http://localhost:${PORT}/test/harness.html`);
    console.log(`  converter UI  http://localhost:${PORT}/src/app/app.html`);
  });
