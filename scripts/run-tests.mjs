#!/usr/bin/env node
/**
 * Headless test runner.
 *
 * Starts the dev server (which serves the extension's real CSP), drives a
 * headless Chrome over the DevTools protocol, and reports what test/harness.js
 * found. No test-framework dependency: the assertions live in the harness so
 * the same suite can also be run by eye in a normal browser.
 *
 *   node scripts/run-tests.mjs [--headed]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8944;
const DEBUG_PORT = 9333;
const HEADED = process.argv.includes('--headed');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('✗ No Chrome/Chromium found. Set CHROME_PATH to your browser binary.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const cleanup = () => {
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

async function waitFor(fn, { timeout = 20000, interval = 200, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* keep polling */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(interval);
  }
}

async function main() {
  const server = spawn('node', [path.join(ROOT, 'scripts/dev-server.mjs'), String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  children.push(server);
  const url = `http://localhost:${PORT}/test/harness.html`;
  await waitFor(() => fetch(url).then((r) => r.ok), { label: 'the dev server' });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sumcheck-test-'));
  const chrome = spawn(
    chromePath,
    [
      HEADED ? '--auto-open-devtools-for-tabs' : '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      url,
    ],
    { stdio: 'ignore' }
  );
  children.push(chrome);

  const target = await waitFor(
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      return list.find((t) => t.type === 'page' && t.url.includes('harness.html'));
    },
    { label: 'the harness page', timeout: 30000 }
  );

  const results = await evaluate(target.webSocketDebuggerUrl);
  report(results);
  // Chrome may still be writing to its profile; cleanup is a courtesy, not a
  // reason to fail a green test run.
  try {
    chrome.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* the OS will reap the temp directory */
  }
  // The spawned server and browser keep the event loop alive; nothing is left
  // to wait for, so tear them down and leave with the right status.
  cleanup();
  process.exit(process.exitCode || 0);
}

/** Runtime.evaluate the harness's completion promise and return its results. */
function evaluate(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('the harness did not finish within 180s'));
    }, 180_000);

    socket.addEventListener('error', (event) => {
      clearTimeout(timer);
      reject(new Error(`devtools socket error: ${event.message || 'unknown'}`));
    });

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            awaitPromise: true,
            returnByValue: true,
            expression: `(async () => {
              const started = Date.now();
              while (!window.__done && Date.now() - started < 170000) {
                await new Promise(r => setTimeout(r, 250));
              }
              return (window.__results || []).map(r => ({
                name: r.name, pass: r.pass, ms: r.ms || 0,
                failures: r.failures, warnings: r.warnings,
              }));
            })()`,
          },
        })
      );
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) return reject(new Error(message.error.message));
      const result = message.result?.result;
      if (result?.subtype === 'error') return reject(new Error(result.description));
      resolve(result?.value || []);
    });
  });
}

function report(results) {
  if (!results.length) {
    console.error('✗ the harness produced no results');
    process.exitCode = 1;
    return;
  }
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const mark = r.pass ? '✓' : '✗';
    console.log(`${mark} ${r.name.padEnd(width)}  ${String(r.ms).padStart(5)}ms`);
    for (const failure of r.failures) console.log(`    ${failure}`);
  }
  const failed = results.filter((r) => !r.pass);
  const total = results.reduce((n, r) => n + r.ms, 0);
  console.log(
    `\n${failed.length ? '✗' : '✓'} ${results.length - failed.length}/${results.length} cases passed in ${total}ms`
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  cleanup();
  process.exit(1);
});
