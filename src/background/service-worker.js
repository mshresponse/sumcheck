/**
 * Service worker: context menus, tab capture, and handing work to the app tab.
 *
 * No conversion happens here — MV3 service workers have no DOM, and every
 * adapter needs DOMParser. The worker's only job is to collect input and open
 * the app with a job id.
 */

const APP_PAGE = 'src/app/app.html';
const JOB_TTL_MS = 5 * 60 * 1000;

/**
 * Menu titles come from `_locales/`. The service worker has `chrome.i18n`
 * available directly, so it needs none of the app's fallback machinery.
 */
const MENUS = [
  { id: 'sumcheck-page', title: chrome.i18n.getMessage('menuPage'), contexts: ['page'] },
  { id: 'sumcheck-selection', title: chrome.i18n.getMessage('menuSelection'), contexts: ['selection'] },
  { id: 'sumcheck-link', title: chrome.i18n.getMessage('menuLink'), contexts: ['link'] },
  { id: 'sumcheck-open', title: chrome.i18n.getMessage('menuOpen'), contexts: ['action'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) chrome.contextMenus.create(menu);
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'sumcheck-open') return void openApp();
    if (info.menuItemId === 'sumcheck-link') return void (await convertLink(info.linkUrl));
    await captureTab(tab, info.menuItemId === 'sumcheck-selection');
  } catch (err) {
    await notifyFailure(err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'capture-tab') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await captureTab(tab, message.selectionOnly);
        sendResponse({ ok: true });
      } else if (message?.type === 'open-app') {
        await openApp();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'Unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true; // keep the channel open for the async reply
});

async function openApp(query = '') {
  await chrome.tabs.create({ url: chrome.runtime.getURL(APP_PAGE) + query });
}

async function captureTab(tab, selectionOnly) {
  if (!tab?.id) throw new Error('No active tab to convert.');
  if (/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || '')) {
    throw new Error('Browser pages cannot be converted.');
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractDocument,
    args: [Boolean(selectionOnly)],
  });
  const payload = injection?.result;
  if (!payload?.html) throw new Error('Nothing could be read from this page.');

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await chrome.storage.session.set({ [jobId]: { ...payload, createdAt: Date.now() } });
  await pruneJobs();
  await openApp(`?job=${jobId}`);
}

/**
 * A linked file lives on some other origin, so the app needs permission to
 * fetch it. Ask now, while we still have the user gesture from the menu click.
 */
async function convertLink(linkUrl) {
  if (!linkUrl) throw new Error('That link has no address.');
  const url = new URL(linkUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) links can be fetched.');

  const origin = `${url.origin}/*`;
  const granted =
    (await chrome.permissions.contains({ origins: [origin] })) ||
    (await chrome.permissions.request({ origins: [origin] }));
  if (!granted) throw new Error(`Permission to read ${url.hostname} was declined.`);

  await openApp(`?url=${encodeURIComponent(linkUrl)}`);
}

async function pruneJobs() {
  const all = await chrome.storage.session.get(null);
  const stale = Object.entries(all)
    .filter(([key, value]) => key.startsWith('job_') && Date.now() - (value?.createdAt || 0) > JOB_TTL_MS)
    .map(([key]) => key);
  if (stale.length) await chrome.storage.session.remove(stale);
}

async function notifyFailure(err) {
  const message = err?.message || String(err);
  console.warn('[Sumcheck]', message);
  try {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: chrome.i18n.getMessage('badgeError', [message]) });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: chrome.i18n.getMessage('appShortName') });
    }, 6000);
  } catch {
    /* the badge is a nicety, not a requirement */
  }
}

/* -------------------------------------------------------------------------
 * Injected into the page. Must be self-contained — it is serialized and run
 * in the page's own world, so it cannot close over anything above.
 * ---------------------------------------------------------------------- */
function extractDocument(selectionOnly) {
  const MAX_BYTES = 8_000_000;

  if (selectionOnly) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      const container = document.createElement('div');
      for (let i = 0; i < selection.rangeCount; i++) {
        container.appendChild(selection.getRangeAt(i).cloneContents());
      }
      const html = container.innerHTML;
      if (html.trim()) {
        return {
          html: `<!doctype html><html><head><title>${document.title}</title></head><body>${html}</body></html>`,
          url: location.href,
          title: document.title,
          selection: true,
        };
      }
    }
  }

  const html = document.documentElement.outerHTML;
  return {
    html: html.length > MAX_BYTES ? html.slice(0, MAX_BYTES) : html,
    truncated: html.length > MAX_BYTES,
    url: location.href,
    title: document.title,
  };
}
