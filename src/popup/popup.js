/** Popup: three entry points, all of which hand off to the background worker. */

import { initI18n, localizeDocument, t } from '../ui/i18n.js';

await initI18n();
localizeDocument();

const status = document.getElementById('status');

const show = (message) => {
  status.hidden = false;
  status.textContent = message;
};

async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || t('popupFailed'));
  window.close();
}

document.getElementById('open').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/app/app.html') });
  window.close();
});

document.getElementById('settings').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/app/app.html?settings=1') });
  window.close();
});

document.getElementById('page').addEventListener('click', async () => {
  try {
    await send({ type: 'capture-tab', selectionOnly: false });
  } catch (err) {
    show(err.message);
  }
});

document.getElementById('selection').addEventListener('click', async () => {
  try {
    await send({ type: 'capture-tab', selectionOnly: true });
  } catch (err) {
    show(err.message);
  }
});
