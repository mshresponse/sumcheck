/**
 * Converter UI.
 *
 * Runs the queue one file at a time: OCR and PDF rasterization are CPU-bound,
 * so parallelism here would only make the progress bar lie.
 */

import { initI18n, localizeDocument, t } from '../ui/i18n.js';
import { convertFile, renderOutputFormat, SUPPORTED_EXTENSIONS } from '../core/convert.js';
import { OUTPUT_FORMATS, DEFAULT_OPTIONS, loadOptions, saveOptions } from '../core/options.js';
import { BUNDLED_LANGUAGES, terminateOcr } from '../core/ocr.js';
import { KIND_LABELS } from '../core/detect.js';
import { humanSize, uid, safeFileName, baseName, extOf } from '../core/util/misc.js';
import { buildDiagnostics } from '../core/diagnostics.js';
import { getJSZip } from '../core/vendor.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  dropzone: $('#dropzone'),
  fileInput: $('#file-input'),
  browse: $('#browse'),
  formatList: $('#format-list'),
  settings: $('#settings'),
  toggleSettings: $('#toggle-settings'),
  workspace: $('#workspace'),
  queue: $('#queue'),
  queueHeading: $('#queue-heading'),
  batch: $('#batch'),
  batchLabel: $('#batch-label'),
  batchSavings: $('#batch-savings'),
  stop: $('#stop'),
  clear: $('#clear'),
  downloadAll: $('#download-all'),
  result: $('#result'),
  resultTitle: $('#result-title'),
  resultMeta: $('#result-meta'),
  resultSavings: $('#result-savings'),
  warnings: $('#warnings'),
  tabs: $('#tabs'),
  panePreview: $('#pane-preview'),
  paneSource: $('#pane-source'),
  copy: $('#copy'),
  copyDiagnostics: $('#copy-diagnostics'),
  downloads: $('#downloads'),
  toast: $('#toast'),
};

const state = {
  options: { ...DEFAULT_OPTIONS },
  items: [],
  selectedId: null, // what the result panel shows
  activeId: null, // what is being converted right now — not the same thing
  activeTab: 'preview',
  running: false,
  controller: null,
};

/* ------------------------------------------------------------------ setup */

init();

async function init() {
  // Before anything renders: the catalogue has to be in hand while the first
  // labels are written, or the page paints its untranslated markup and then
  // visibly swaps it.
  await initI18n();
  localizeDocument();
  state.options = await loadOptions();
  buildLanguageOptions();
  applyOptionsToForm();
  el.formatList.textContent = t('supportedFormats', SUPPORTED_EXTENSIONS.join(' '));
  wireEvents();
  await loadPendingJob();
}

function buildLanguageOptions() {
  const select = el.settings.querySelector('[name="ocrLang"]');
  // Built as elements. The values are bundled constants today, but a language
  // list is exactly the sort of thing that later gets read from a manifest or a
  // vendored file, and this is the last place in the app that interpolated
  // anything into markup.
  select.replaceChildren(
    ...BUNDLED_LANGUAGES.map((language) => {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = language.label;
      return option;
    })
  );
}

function wireEvents() {
  el.toggleSettings.addEventListener('click', () => {
    const open = el.settings.hidden;
    el.settings.hidden = !open;
    el.toggleSettings.setAttribute('aria-expanded', String(open));
  });

  el.settings.addEventListener('change', onOptionChange);

  el.browse.addEventListener('click', (e) => {
    e.stopPropagation();
    el.fileInput.click();
  });
  el.dropzone.addEventListener('click', () => el.fileInput.click());
  el.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.fileInput.click();
    }
  });
  // One listener for the whole list, so a row costs nothing to add and rows can
  // be reused across renders instead of rebuilt to re-bind their handler.
  el.queue.addEventListener('click', (event) => {
    const row = event.target.closest?.('.queue-item');
    if (row?.dataset.id) select(row.dataset.id);
  });

  el.fileInput.addEventListener('change', () => {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  for (const type of ['dragenter', 'dragover']) {
    document.addEventListener(type, (e) => {
      e.preventDefault();
      el.dropzone.classList.add('dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    document.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === 'drop' || e.target === document.documentElement) {
        el.dropzone.classList.remove('dragging');
      }
    });
  }
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  document.addEventListener('paste', onPaste);

  el.clear.addEventListener('click', () => {
    state.controller?.abort();
    state.items = [];
    state.selectedId = null;
    state.activeId = null;
    renderQueue();
    el.result.hidden = true;
    el.workspace.hidden = true;
    el.batch.hidden = true;
    el.dropzone.classList.remove('compact');
    terminateOcr();
  });

  el.stop.addEventListener('click', () => {
    state.controller?.abort();
    // Anything not started yet never will be; the running file stops at its
    // next page boundary.
    for (const item of state.items) {
      if (item.status === 'queued') {
        item.status = 'error';
        item.error = 'Skipped — the batch was stopped.';
        item.label = t('statusSkipped');
      }
    }
    el.stop.disabled = true;
    el.stop.textContent = t('stopping');
    renderQueue();
  });

  el.copy.addEventListener('click', copyActive);
  el.copyDiagnostics.addEventListener('click', copyDiagnostics);
  el.downloadAll.addEventListener('click', downloadAll);
}

function onOptionChange() {
  const form = el.settings;
  const outputs = Array.from(form.querySelectorAll('[name="outputs"]:checked')).map((i) => i.value);
  const value = (name) => form.querySelector(`[name="${name}"]`);
  const checked = (name) => value(name)?.checked;

  state.options = {
    ...state.options,
    outputs: outputs.length ? outputs : ['md'],
    ocrMode: value('ocrMode').value,
    ocrLang: value('ocrLang').value,
    ocrResolution:
      value('ocrResolution').value === 'auto' ? 'auto' : Number(value('ocrResolution').value),
    ocrPreprocess: value('ocrPreprocess').value,
    validate: checked('validate'),
    reviewMarkers: checked('reviewMarkers'),
    pdfHeadings: checked('pdfHeadings'),
    pdfTables: checked('pdfTables'),
    stripRunningHeads: checked('stripRunningHeads'),
    pdfLinks: checked('pdfLinks'),
    pdfColumns: value('pdfColumns').value,
    pageMarkers: value('pageMarkers').value,
    imageMode: value('imageMode').value,
    frontMatter: checked('frontMatter'),
    readability: checked('readability'),
    includeSpeakerNotes: checked('includeSpeakerNotes'),
    mdFlavor: value('mdFlavor').value,
    wrap: Number(value('wrap').value) || 0,
  };

  if (!outputs.length) {
    form.querySelector('[name="outputs"][value="md"]').checked = true;
  }
  saveOptions(state.options);
}

function applyOptionsToForm() {
  const form = el.settings;
  for (const box of form.querySelectorAll('[name="outputs"]')) {
    box.checked = state.options.outputs.includes(box.value);
  }
  for (const [key, val] of Object.entries(state.options)) {
    if (key === 'outputs') continue;
    const field = form.querySelector(`[name="${key}"]`);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(val);
    else field.value = String(val);
  }
}

/* ------------------------------------------------------------------ input */

async function onPaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) {
    event.preventDefault();
    addFiles(files);
    return;
  }
  const html = event.clipboardData?.getData('text/html');
  const text = event.clipboardData?.getData('text/plain');
  if (html) {
    event.preventDefault();
    enqueue({ id: uid('item'), name: 'clipboard.html', size: html.length, html });
    runQueue();
  } else if (text && text.length > 40) {
    event.preventDefault();
    const bytes = new TextEncoder().encode(text);
    enqueue({ id: uid('item'), name: 'clipboard.txt', size: bytes.byteLength, bytes });
    runQueue();
  }
}

async function addFiles(fileList) {
  for (const file of Array.from(fileList)) {
    enqueue(
      { id: uid('item'), name: file.name, size: file.size, mime: file.type, file },
      { defer: true } // one render for the whole drop, not one per file
    );
  }
  renderQueue();
  runQueue();
}

function enqueue(item, { defer = false } = {}) {
  state.items.push({ status: 'queued', progress: 0, label: t('statusQueued'), ...item });
  el.workspace.hidden = false;
  el.dropzone.classList.add('compact');
  if (!defer) renderQueue();
}

async function loadPendingJob() {
  const params = new URLSearchParams(location.search);

  if (params.get('settings') === '1') {
    el.settings.hidden = false;
    el.toggleSettings.setAttribute('aria-expanded', 'true');
  }

  const remoteUrl = params.get('url');
  if (remoteUrl) await fetchRemote(remoteUrl);

  const jobId = params.get('job');
  if (!jobId || typeof chrome === 'undefined' || !chrome.storage?.session) return;
  try {
    const store = await chrome.storage.session.get(jobId);
    const job = store[jobId];
    if (!job) return;
    await chrome.storage.session.remove(jobId);
    enqueue({
      id: uid('item'),
      name: `${safeFileName(job.title || 'page')}.html`,
      size: job.html?.length || 0,
      html: job.html,
      url: job.url,
    });
    runQueue();
  } catch (err) {
    toast(t('toastCaptureFailed', err.message));
  }
}

/**
 * "Convert linked file" hands the URL over here; the background worker has
 * already secured host permission for that origin.
 */
async function fetchRemote(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'download');
    enqueue({
      id: uid('item'),
      name,
      size: buffer.byteLength,
      mime: response.headers.get('content-type')?.split(';')[0] || '',
      bytes: new Uint8Array(buffer),
      url,
    });
    runQueue();
  } catch (err) {
    toast(t('toastDownloadFailed', err.message));
  }
}

/* ---------------------------------------------------------------- running */

async function runQueue() {
  if (state.running) return;
  state.running = true;
  state.controller = new AbortController();
  el.stop.hidden = false;
  el.stop.disabled = false;
  el.stop.textContent = t('stop');

  try {
    for (;;) {
      const item = state.items.find((i) => i.status === 'queued');
      if (!item || state.controller.signal.aborted) break;
      await runItem(item);
      updateBatch();
    }
  } finally {
    state.running = false;
    state.activeId = null;
    state.controller = null;
    el.stop.hidden = true;
    el.downloadAll.disabled = !state.items.some((i) => i.status === 'done');
    updateBatch();
    renderQueue();
  }
}

/**
 * Batch progress, separate from the per-file bar. With fifty scanned PDFs the
 * per-file percentage restarts constantly; this line is the one that answers
 * "how far along is this actually".
 */
function updateBatch() {
  // An archive is a container, not a document. Counting it in the denominator
  // is why a finished batch reported "50 of 51" and left the bar just short.
  const documents = state.items.filter((i) => i.status !== 'expanded');
  const total = documents.length;
  const finished = documents.filter((i) => i.status === 'done' || i.status === 'error').length;
  const failed = documents.filter((i) => i.status === 'error').length;
  const active = documents.find((i) => i.id === state.activeId);

  el.queueHeading.textContent = total > 1 ? t('queueCount', total) : t('queue');

  if (total < 2) {
    el.batch.hidden = true;
    return;
  }
  el.batch.hidden = false;
  el.batch.querySelector('.batch-bar > div').style.width = `${Math.round((finished / total) * 100)}%`;

  if (!state.running) {
    el.batchLabel.textContent =
      t('batchDone', finished - failed, total) + (failed ? t('batchFailedSuffix', failed) : '');
    const totals = batchSavings(documents);
    el.batchSavings.textContent = totals;
    el.batchSavings.hidden = !totals;
    return;
  }
  el.batchSavings.hidden = true;
  // With a long queue the working row is usually scrolled out of sight, so the
  // live per-file progress belongs here, where it is always visible.
  const position = Math.min(finished + 1, total);
  const detail = active?.label && active.label !== 'Queued' ? ` · ${active.label}` : '';
  el.batchLabel.textContent =
    t('batchProgress', position, total, active ? active.name : '') +
    detail +
    (failed ? t('batchFailedSuffix', failed) : '');
}

async function runItem(item) {
  item.status = 'working';
  item.label = t('statusReading');
  item.progress = 0.02;
  state.activeId = item.id;
  // Move the "working" marker without rebuilding 50 rows, and keep the active
  // row visible by scrolling the queue itself rather than the whole page.
  for (const row of el.queue.querySelectorAll('.queue-item.working')) row.classList.remove('working');
  const row = el.queue.querySelector(`[data-id="${item.id}"]`);
  if (row) {
    row.classList.add('working');
    const top = row.offsetTop - el.queue.offsetTop;
    if (top < el.queue.scrollTop || top + row.offsetHeight > el.queue.scrollTop + el.queue.clientHeight) {
      el.queue.scrollTop = top - el.queue.clientHeight / 2 + row.offsetHeight / 2;
    }
  }
  updateQueueRow(item);
  updateBatch();

  try {
    if (item.file && !item.bytes) {
      item.bytes = new Uint8Array(await item.file.arrayBuffer());
      item.file = null; // let the File handle go; we hold the bytes now
    }

    const result = await convertFile(
      { bytes: item.bytes, name: item.name, mime: item.mime, url: item.url, html: item.html },
      state.options,
      {
        signal: state.controller?.signal,
        onProgress: (fraction, label) => {
          // Tesseract's logger can fire once more after recognize() resolves;
          // without this guard a finished row reverts to "OCR 100%".
          if (item.status !== 'working') return;
          if (typeof fraction === 'number') item.progress = fraction;
          if (label) item.label = label;
          updateQueueRow(item);
          updateBatch();
        },
        requestPassword: (retry) => askForPassword(item.name, retry),
      }
    );

    if (result.expand) {
      item.status = 'expanded';
      item.label = t('expandedCount', result.expand.length);
      const index = state.items.indexOf(item);
      const children = result.expand.map((child) => ({
        ...child,
        status: 'queued',
        progress: 0,
        label: t('statusQueued'),
        size: child.bytes.byteLength,
      }));
      state.items.splice(index + 1, 0, ...children);
      renderQueue();
      return;
    }

    item.result = result;
    item.status = 'done';
    item.label = result.outputs.map((o) => `.${o.ext}`).join(' ');
    item.progress = 1;
    // The source bytes are no longer needed, and holding fifty PDFs in memory
    // alongside their converted output is how a big batch runs the tab out.
    item.bytes = null;
    if (!state.selectedId || state.selectedId === item.id) select(item.id);
  } catch (err) {
    item.status = 'error';
    item.error = err?.message || String(err);
    item.label = t('statusFailed');
    console.error(`[Sumcheck] ${item.name}:`, err);
  }
  renderQueue();
  el.downloadAll.disabled = !state.items.some((i) => i.status === 'done');
}

/* ----------------------------------------------------------------- render */

/**
 * Bring the rendered queue into line with `state.items`.
 *
 * This used to empty `#queue` and rebuild every row on each item's completion,
 * with a fresh click listener per row. On the 50-file batches this pipeline is
 * tuned for that is quadratic, and it is not theoretical: measured on a
 * 200-file batch it constructed **40,600 rows** and spent 2.1 seconds doing it,
 * to display 200. It also threw away scroll position, focus and any text
 * selection inside the queue on every single completion.
 *
 * Rows are now created once and patched in place, and clicks are handled by one
 * delegated listener on the list. Reconciling in `state.items` order matters
 * because a zip expands into children that are spliced in mid-list.
 */
function renderQueue() {
  el.workspace.hidden = state.items.length === 0;

  const existing = new Map();
  for (const row of el.queue.children) existing.set(row.dataset.id, row);

  let cursor = el.queue.firstElementChild;
  for (const item of state.items) {
    const row = existing.get(item.id) || createQueueRow(item);
    if (row === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      // Insert, or move an out-of-order row into place. `cursor` stays put:
      // it is still the next row we expect to match.
      el.queue.insertBefore(row, cursor);
    }
    updateQueueRow(item);
  }

  const live = new Set(state.items.map((i) => i.id));
  for (const row of [...el.queue.children]) {
    if (!live.has(row.dataset.id)) row.remove();
  }
}

/** The row's fixed parts. Everything that changes lives in updateQueueRow. */
function createQueueRow(item) {
  const li = document.createElement('li');
  li.className = 'queue-item';
  li.dataset.id = item.id;
  // A fixed skeleton with no interpolation at all — every value below is set
  // with textContent.
  li.innerHTML = `
      <span class="icon"></span>
      <span>
        <span class="name"></span>
        <span class="sub"></span>
        <span class="progress"><div></div></span>
      </span>
      <span class="status"></span>`;
  // Both of these come from the file name, so they are set as text rather than
  // interpolated into the markup. The extension used to be spliced straight
  // into innerHTML, which a file called `report.<img>` would have exploited.
  li.querySelector('.icon').textContent = (extOf(item.name) || 'txt').slice(0, 4).toUpperCase();
  li.querySelector('.name').textContent = item.name;
  return li;
}

function updateQueueRow(item) {
  const row = el.queue.querySelector(`[data-id="${item.id}"]`);
  if (!row) return;
  row.querySelector('.sub').textContent = [
    humanSize(item.size),
    item.result?.detected?.kind ? KIND_LABELS[item.result.detected.kind] : null,
    item.result?.meta?.pages ? `${item.result.meta.pages} pages` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  row.classList.toggle('working', item.id === state.activeId && item.status === 'working');
  const status = row.querySelector('.status');
  status.className = `status ${item.status === 'done' ? 'done' : item.status === 'error' ? 'error' : 'working'}`;
  if (item.status === 'error') {
    status.textContent = t('statusFailedDetail');
    status.title = item.error;
  } else {
    status.textContent = item.label;
    status.removeAttribute('title');
  }
  const bar = row.querySelector('.progress > div');
  bar.style.width = `${Math.round((item.progress || 0) * 100)}%`;
  row.querySelector('.progress').style.visibility =
    item.status === 'working' ? 'visible' : 'hidden';
  row.setAttribute('aria-selected', String(item.id === state.selectedId));
}

function select(id) {
  state.selectedId = id;
  for (const row of el.queue.querySelectorAll('.queue-item')) {
    row.setAttribute('aria-selected', String(row.dataset.id === id));
  }
  const item = state.items.find((i) => i.id === id);
  if (item?.status === 'error') {
    renderError(item);
    return;
  }
  if (!item?.result) {
    el.result.hidden = true;
    return;
  }
  renderResult(item);
}

/** A failed file still deserves the panel — that is where the reason fits. */
function renderError(item) {
  el.result.hidden = false;
  el.resultTitle.textContent = item.name;
  el.resultMeta.textContent = `${humanSize(item.size)} · could not be converted`;
  el.resultSavings.textContent = '';
  el.warnings.hidden = false;
  // Built as nodes rather than markup: the reason text comes from a caught
  // error, which can carry a file name.
  el.warnings.replaceChildren();
  const failedHeading = document.createElement('strong');
  failedHeading.textContent = t('whyThisFailed');
  const failedReason = document.createElement('p');
  el.warnings.append(failedHeading, failedReason);
  el.warnings.querySelector('p').textContent = item.error;
  el.tabs.innerHTML = '';
  el.panePreview.hidden = false;
  el.paneSource.hidden = true;
  el.panePreview.innerHTML = '';
  el.copy.disabled = true;
  el.downloads.innerHTML = '';
}

function renderResult(item) {
  const { result } = item;
  el.result.hidden = false;
  el.copy.disabled = false;
  el.resultTitle.textContent = result.meta.title || item.name;

  const bits = [
    KIND_LABELS[result.detected?.kind] || result.meta.kind,
    result.meta.pages && `${result.meta.pages} pages`,
    result.meta.slides && `${result.meta.slides} slides`,
    result.meta.sheets && `${result.meta.sheets} sheets`,
    result.meta.ocrPages && `${result.meta.ocrPages} OCR pages`,
    result.meta.ocrConfidence && `OCR confidence ${result.meta.ocrConfidence}%`,
    result.assets?.length && `${result.assets.length} extracted images`,
  ].filter(Boolean);
  el.resultMeta.textContent = bits.join(' · ');

  if (result.warnings?.length) {
    el.warnings.hidden = false;
    // Built as nodes: the warning strings come from the conversion core and
    // can quote a file's own text.
    el.warnings.replaceChildren();
    const notesHeading = document.createElement('strong');
    notesHeading.textContent = t('notes');
    const list = document.createElement('ul');
    for (const warning of result.warnings) {
      const li = document.createElement('li');
      li.textContent = warning;
      list.appendChild(li);
    }
    el.warnings.append(notesHeading, list);
  } else {
    el.warnings.hidden = true;
  }

  // Every format is offered, whether or not it was pre-selected in Settings.
  // The conversion is already done; producing another view of it is cheap, and
  // making someone re-run a batch to look at the HTML would be silly.
  const tabs = [
    { id: 'preview', label: t('preview') },
    ...OUTPUT_FORMATS.map((f) => ({ id: f.id, label: f.label })),
  ];
  if (!tabs.some((t) => t.id === state.activeTab)) state.activeTab = 'preview';

  el.tabs.innerHTML = '';
  for (const tab of tabs) {
    const button = document.createElement('button');
    button.className = 'tab';
    button.type = 'button';
    button.role = 'tab';
    button.textContent = tab.label;
    button.setAttribute('aria-selected', String(tab.id === state.activeTab));
    button.addEventListener('click', () => {
      state.activeTab = tab.id;
      renderResult(item);
    });
    el.tabs.appendChild(button);
  }

  if (state.activeTab === 'preview') {
    el.panePreview.hidden = false;
    el.paneSource.hidden = true;
    /**
     * The one place converted document HTML is rendered as HTML, which is the
     * whole point of a preview pane.
     *
     * `result.preview` is the fragment after `sanitizeHtml()` — DOMPurify with
     * this project's config, applied in `convert.js` before any emitter or
     * validator sees it. `src/core/sanitize.js` is the single chokepoint every
     * adapter's output passes through, so the guarantee is structural rather
     * than a property of this call site. The fallback is a literal.
     */
    el.panePreview.innerHTML = result.preview || '<p><em>(no content)</em></p>';
  } else {
    const output = ensureOutput(item, state.activeTab);
    el.panePreview.hidden = true;
    el.paneSource.hidden = false;
    el.paneSource.querySelector('code').textContent = output?.content || '';
  }

  const target = targetFormat();
  el.copy.textContent = t('copyFormat', extFor(target));
  renderDownloadButtons(item, target);

  const shown = ensureOutput(item, target);
  el.resultSavings.textContent = savingsLine(
    item.size,
    shown?.bytes || 0,
    result.meta?.estimatedTokens || 0,
    extFor(target)
  );
}

/**
 * One button per format, always visible. The tabs already let you view any
 * format, but a download shouldn't require finding the right tab first.
 */
function renderDownloadButtons(item, target) {
  el.downloads.innerHTML = '';
  for (const spec of OUTPUT_FORMATS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn${spec.id === target ? ' primary' : ''}`;
    button.textContent = `.${spec.ext}`;
    button.title = t('downloadAs', spec.label);
    button.addEventListener('click', () => downloadFormat(item, spec.id));
    el.downloads.appendChild(button);
  }
}


/**
 * Size and token savings for one conversion.
 *
 * Measured against the format the Copy and Download buttons act on, so the
 * number always describes the file the reader is about to take away rather than
 * an average across the four formats.
 *
 * The token figure is an estimate — characters over four — and says so. A real
 * tokenizer would be exact for one model and wrong for the next, and would cost
 * megabytes of vocabulary to ship for a number nobody acts on to that
 * precision. An estimate labelled as an estimate is more honest than a precise
 * number that is precisely wrong.
 */
function savingsLine(sourceBytes, outputBytes, tokens, ext) {
  const parts = [];
  if (sourceBytes > 0 && outputBytes > 0) {
    parts.push(t('savingsSizes', humanSize(sourceBytes), humanSize(outputBytes), ext));
    const change = Math.round((1 - outputBytes / sourceBytes) * 100);
    if (change > 0) parts.push(t('savingsSmaller', change));
    else if (change < 0) parts.push(t('savingsLarger', -change));
    else parts.push(t('savingsSameSize'));
  } else if (outputBytes > 0) {
    parts.push(t('savingsOutputOnly', humanSize(outputBytes), ext));
  }
  if (tokens > 0) parts.push(t('savingsTokens', compactCount(tokens)));
  return parts.join(' · ');
}

/** Thousands and millions, because an estimate written to six digits lies. */
function compactCount(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** Totals across a batch: the same three numbers, summed over what finished. */
function batchSavings(documents) {
  let sourceBytes = 0;
  let outputBytes = 0;
  let tokens = 0;
  let counted = 0;
  for (const item of documents) {
    if (item.status !== 'done' || !item.result) continue;
    const output = item.result.outputs[0];
    if (!output) continue;
    sourceBytes += item.size || 0;
    outputBytes += output.bytes || 0;
    tokens += item.result.meta?.estimatedTokens || 0;
    counted++;
  }
  if (!counted) return '';
  const parts = [];
  if (sourceBytes > 0 && outputBytes > 0) {
    parts.push(t('savingsSizesPlain', humanSize(sourceBytes), humanSize(outputBytes)));
    const change = Math.round((1 - outputBytes / sourceBytes) * 100);
    if (change > 0) parts.push(t('savingsSmaller', change));
    else if (change < 0) parts.push(t('savingsLarger', -change));
    else parts.push(t('savingsSameSize'));
  }
  if (tokens > 0) parts.push(t('savingsTokens', compactCount(tokens)));
  return parts.length ? t('batchSavings', counted, parts.join(' · ')) : '';
}

const extFor = (format) => OUTPUT_FORMATS.find((f) => f.id === format)?.ext || format;

/** The format the Copy/Download buttons act on. */
function targetFormat() {
  return state.activeTab === 'preview' ? 'md' : state.activeTab;
}

/**
 * Produce a format on demand from the already-sanitized document, and remember
 * it. Formats generated this way are marked so "Download all" still honours the
 * user's chosen output set rather than everything they happened to click on.
 */
function ensureOutput(item, format) {
  const existing = item.result.outputs.find((o) => o.format === format);
  if (existing) return existing;
  const generated = renderOutputFormat(format, {
    html: item.result.preview,
    meta: item.result.meta,
    opts: state.options,
    nativeMarkdown: item.result.nativeMarkdown,
    name: item.name,
  });
  if (generated) {
    generated.onDemand = true;
    item.result.outputs.push(generated);
  }
  return generated;
}

/* ----------------------------------------------------------------- output */

function activeOutput() {
  const item = state.items.find((i) => i.id === state.selectedId);
  if (!item?.result) return null;
  return { item, output: ensureOutput(item, targetFormat()) };
}

/**
 * Diagnostic context for a bug report, with nothing of the document in it.
 *
 * Available on a failure as well as a success, because a conversion that threw
 * is exactly when someone needs to describe what happened — and the reason it
 * threw is the one string here that could quote the document, so it is the one
 * string not included. The payload says the conversion failed and stops there.
 */
async function copyDiagnostics() {
  const item = state.items.find((i) => i.id === state.selectedId);
  const payload = buildDiagnostics({
    meta: item?.result?.meta,
    review: item?.result?.review,
    options: state.options,
    kind: item?.result?.detected?.kind || item?.detected?.kind,
    failed: item?.status === 'error',
  });
  try {
    await navigator.clipboard.writeText(payload);
    toast(t('toastDiagnosticsCopied'));
  } catch {
    toast(t('toastClipboardDenied'));
  }
}

async function copyActive() {
  const active = activeOutput();
  if (!active?.output) return;
  try {
    await navigator.clipboard.writeText(active.output.content);
    toast(t('toastCopied', active.output.filename));
  } catch {
    toast(t('toastClipboardDenied'));
  }
}

function downloadFormat(item, format) {
  const output = ensureOutput(item, format);
  if (!output) return;
  // Extracted images have to travel with the Markdown that references them.
  if (item.result.assets?.length && format === 'md') {
    downloadZip([item], `${safeFileName(baseName(item.name))}.zip`);
    return;
  }
  saveBlob(new Blob([output.content], { type: `${output.mime};charset=utf-8` }), output.filename);
}

async function downloadAll() {
  const done = state.items.filter((i) => i.status === 'done');
  if (!done.length) return;
  const chosen = (item) => item.result.outputs.filter((o) => !o.onDemand);
  if (done.length === 1 && !done[0].result.assets?.length && chosen(done[0]).length === 1) {
    const output = chosen(done[0])[0];
    saveBlob(new Blob([output.content], { type: `${output.mime};charset=utf-8` }), output.filename);
    return;
  }
  await downloadZip(done, 'sumcheck-export.zip');
}

async function downloadZip(items, zipName) {
  const zip = new (getJSZip())();
  const used = new Set();
  for (const item of items) {
    // Only the formats the user asked for — not ones they merely previewed.
    for (const output of item.result.outputs.filter((o) => !o.onDemand)) {
      zip.file(uniqueName(used, output.filename), output.content);
    }
    for (const asset of item.result.assets || []) {
      zip.file(asset.path, asset.bytes);
    }
  }
  toast(t('toastBuildingArchive'));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  saveBlob(blob, zipName);
}

function uniqueName(used, name) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n++;
  used.add(`${stem}-${n}${ext}`);
  return `${stem}-${n}${ext}`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  toast(t('toastSaved', filename));
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2600);
}
/* ------------------------------------------------------------- password */

/**
 * Ask for a document's password without stopping the world.
 *
 * `window.prompt()` blocks the page's whole event loop. In a 50-file batch that
 * means one locked PDF freezes every other conversion — no progress, no
 * repaint, nothing — until somebody returns to the tab and answers it. It is
 * also suppressed outright in some contexts, which turns a prompt into a
 * conversion that mysteriously never finishes.
 *
 * This resolves with the password, or with null for "skip this file", which the
 * PDF adapter turns into a failure with a reason the reader can act on. The
 * queue keeps moving either way.
 *
 * @returns {Promise<string|null>}
 */
function askForPassword(fileName, retry) {
  const backdrop = document.getElementById('password-backdrop');
  const form = document.getElementById('password-form');
  const input = document.getElementById('password-input');
  const message = document.getElementById('password-message');
  const skip = document.getElementById('password-skip');
  const submit = document.getElementById('password-submit');

  message.textContent = retry ? t('passwordRetry', fileName) : t('passwordFor', fileName);
  message.classList.toggle('wrong', Boolean(retry));
  input.value = '';
  backdrop.hidden = false;
  // Focus lands on the field, so typing works immediately and screen readers
  // announce the dialog rather than whatever was focused before.
  const previouslyFocused = document.activeElement;
  input.focus();

  return new Promise((resolve) => {
    const finish = (value) => {
      backdrop.hidden = true;
      form.removeEventListener('submit', onSubmit);
      skip.removeEventListener('click', onSkip);
      backdrop.removeEventListener('keydown', onKeydown);
      backdrop.removeEventListener('mousedown', onBackdrop);
      input.value = ''; // do not leave the password sitting in the DOM
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(value);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      // An empty box is not a password; treat Enter on it as "keep asking"
      // rather than silently skipping the file.
      if (!input.value) {
        input.focus();
        return;
      }
      finish(input.value);
    };
    const onSkip = () => finish(null);
    const onBackdrop = (event) => {
      if (event.target === backdrop) finish(null);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus trap: three focusable controls, cycled by hand. Without it Tab
      // walks out of the dialog and into the page behind it, which for a
      // keyboard user means the dialog is a dead end.
      const focusable = [input, skip, submit];
      const index = focusable.indexOf(document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      const next = event.shiftKey
        ? (index - 1 + focusable.length) % focusable.length
        : (index + 1) % focusable.length;
      focusable[next].focus();
    };

    form.addEventListener('submit', onSubmit);
    skip.addEventListener('click', onSkip);
    backdrop.addEventListener('keydown', onKeydown);
    backdrop.addEventListener('mousedown', onBackdrop);
  });
}

