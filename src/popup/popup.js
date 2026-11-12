/**
 * Feedly Saved Opener - popup.
 *
 * A view over extension storage: it renders the cached list at once, asks the
 * background to refresh when the list is stale, and re-renders on every storage
 * change (sync results, job progress). Actions go to the background as messages.
 */

import {
  aggregateStats,
  batchCount,
  countLabel,
  formatRelativeTime,
  isOpenableUrl,
  isStale,
  normalizeSettings,
  orderArticles,
  parsePriorityDomains,
  popupView
} from '../shared/core.js';
import { createStore, LOCAL, SESSION } from '../shared/store.js';

const store = createStore(browser.storage);

const ARTICLE_LIST_LIMIT = 50;
const SETTINGS_DEBOUNCE_MS = 400;
const RECENT_JOB_MS = 30 * 1000;
const MAX_TOASTS = 3;

const $ = (id) => document.getElementById(id);

const el = {
  views: {
    loading: $('view-loading'),
    connect: $('view-connect'),
    main: $('view-main')
  },
  connectMessage: $('connect-message'),
  connectForm: $('connect-form'),
  tokenInput: $('token-input'),
  toggleTokenBtn: $('toggle-token-btn'),
  connectBtn: $('connect-btn'),
  getTokenBtn: $('get-token-btn'),
  articleCount: $('article-count'),
  syncStatus: $('sync-status'),
  jobPanel: $('job-panel'),
  jobProgress: $('job-progress'),
  jobText: $('job-text'),
  cancelBtn: $('cancel-btn'),
  actions: $('actions'),
  openBatchBtn: $('open-batch-btn'),
  openAllBtn: $('open-all-btn'),
  emptyState: $('empty-state'),
  goToFeedlyBtn: $('go-to-feedly-btn'),
  settings: $('settings'),
  settingsSummary: $('settings-summary'),
  batchSize: $('batch-size-input'),
  sortOrder: $('sort-order-select'),
  priorityDomains: $('priority-domains-input'),
  groupTabsRow: $('group-tabs-row'),
  groupTabs: $('group-tabs-input'),
  shortcutHint: $('shortcut-hint'),
  articles: $('articles'),
  articleList: $('article-list'),
  stats: $('stats'),
  statsSummary: $('stats-summary'),
  statsBody: $('stats-body'),
  exportLogBtn: $('export-log-btn'),
  clearLogBtn: $('clear-log-btn'),
  refreshBtn: $('refresh-btn'),
  exportBtn: $('export-btn'),
  version: $('version'),
  disconnectBtn: $('disconnect-btn'),
  dialog: $('confirm-dialog'),
  dialogTitle: $('confirm-title'),
  dialogMessage: $('confirm-message'),
  dialogOk: $('confirm-ok'),
  toasts: $('toasts')
};

/** Mirror of the storage keys the popup shows */
const state = {
  token: null,
  authError: false,
  articles: [],
  syncedAt: null,
  settings: null,
  clickLog: [],
  job: null,
  syncStatus: null
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Creates an element with text content; never parses HTML.
 * @param {string} tag
 * @param {Object} [props] - className, textContent, title
 * @param {Array<Node>} [children]
 * @returns {HTMLElement}
 */
function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function isJobActive(job = state.job) {
  return Boolean(job && (job.status === 'running' || job.status === 'cancelling'));
}

function orderedArticles() {
  return orderArticles(state.articles, state.settings);
}

/**
 * Sends a message to the background and turns an error reply into a throw.
 * @param {Object} message
 * @returns {Promise<Object>}
 */
async function send(message) {
  const reply = await browser.runtime.sendMessage(message);
  if (reply?.error) {
    const error = new Error(reply.error);
    error.kind = reply.kind;
    throw error;
  }
  return reply ?? {};
}

const ERROR_MESSAGES = {
  auth: 'Feedly rejected the token. Paste a new one.',
  network: 'Couldn\'t reach Feedly. Showing your saved list as it was.',
  timeout: 'Feedly didn\'t answer in time. Try again in a moment.',
  'rate-limit': 'Feedly\'s request limit was reached. Try again later.',
  server: 'Feedly had a problem. Try again in a minute.',
  busy: 'Articles are already opening.'
};

function errorMessage(error) {
  return ERROR_MESSAGES[error.kind] || error.message || 'Something went wrong.';
}

/**
 * Runs an action with a spinner on its button.
 * @param {HTMLButtonElement} button
 * @param {() => Promise<void>} action
 */
async function withSpinner(button, action) {
  button.classList.add('btn-loading');
  button.disabled = true;
  try {
    await action();
  } finally {
    button.classList.remove('btn-loading');
    button.disabled = false;
    render();
  }
}

function showToast(message, type = 'info', duration = 3000) {
  while (el.toasts.children.length >= MAX_TOASTS) {
    el.toasts.firstElementChild.remove();
  }
  const toast = h('div', { className: `toast ${type}`, textContent: message });
  el.toasts.append(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * @param {{title: string, message: string, confirm: string}} options
 * @returns {Promise<boolean>}
 */
function confirmDialog({ title, message, confirm }) {
  el.dialogTitle.textContent = title;
  el.dialogMessage.textContent = message;
  el.dialogOk.textContent = confirm;
  el.dialog.returnValue = '';
  el.dialog.showModal();
  return new Promise((resolve) => {
    el.dialog.addEventListener('close', () => resolve(el.dialog.returnValue === 'confirm'), { once: true });
  });
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =============================================================================
// Rendering
// =============================================================================

function showView(name) {
  for (const [key, view] of Object.entries(el.views)) {
    view.hidden = key !== name;
  }
}

function renderSyncStatus() {
  const status = state.syncStatus ?? {};
  const error = status.lastError;
  let text = '';
  let warning = false;

  if (status.running) {
    text = 'Updating…';
  } else if (status.rateLimitedUntil > Date.now()) {
    text = `Feedly request limit reached; retrying after ${new Date(status.rateLimitedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    warning = true;
  } else if (error && error.kind !== 'auth' && error.at >= (state.syncedAt ?? 0)) {
    const reason = error.kind === 'network' ? 'offline' : error.message;
    text = state.syncedAt
      ? `Couldn't update (${reason}). List from ${formatRelativeTime(state.syncedAt)}.`
      : `Couldn't load your saved list (${reason}). Try Refresh.`;
    warning = true;
  } else if (state.syncedAt) {
    text = `Updated ${formatRelativeTime(state.syncedAt)}`;
  }

  el.syncStatus.textContent = text;
  el.syncStatus.classList.toggle('warning', warning);
}

function renderJob() {
  const job = state.job;
  const recent = job?.finishedAt && Date.now() - job.finishedAt < RECENT_JOB_MS;
  if (!job || (!isJobActive(job) && !recent)) {
    el.jobPanel.hidden = true;
    return;
  }

  el.jobPanel.hidden = false;
  el.jobProgress.max = Math.max(1, job.total);
  el.jobProgress.value = job.opened + job.skipped;
  el.cancelBtn.hidden = job.status !== 'running';

  const parts = [];
  if (job.status === 'running') {
    parts.push(`Opening ${Math.min(job.total, job.opened + job.skipped + 1)} of ${job.total}…`);
  } else if (job.status === 'cancelling') {
    parts.push('Stopping…');
  } else if (job.status === 'cancelled') {
    parts.push(`Stopped after ${countLabel(job.opened, 'article')}.`);
  } else if (job.status === 'failed') {
    parts.push(`Stopped after ${countLabel(job.opened, 'article')}: ${errorMessage(job.error ?? {})}`);
  } else {
    parts.push(`Opened ${countLabel(job.opened, 'article')}.`);
  }
  if (job.skipped > 0) {
    parts.push(`${job.skipped} failed to open.`);
  }
  if (job.unsaveFailed > 0) {
    parts.push(`${job.unsaveFailed} couldn't be unsaved and stay saved in Feedly.`);
  }
  el.jobText.textContent = parts.join(' ');
}

function renderArticleList(articles) {
  el.articles.hidden = articles.length === 0;
  if (!el.articles.open) {
    return;
  }
  const items = articles.slice(0, ARTICLE_LIST_LIMIT).map(article => h('li', {}, [
    h('span', { className: 'article-title', textContent: article.title, title: article.title }),
    h('span', { className: 'article-source', textContent: article.source || 'Unknown source' })
  ]));
  if (articles.length > ARTICLE_LIST_LIMIT) {
    items.push(h('li', { className: 'article-more', textContent: `and ${articles.length - ARTICLE_LIST_LIMIT} more` }));
  }
  el.articleList.replaceChildren(...items);
}

function renderStats() {
  if (!el.stats.open) {
    return;
  }
  const { total, first, last, top } = aggregateStats(state.clickLog);
  if (total === 0) {
    el.statsSummary.textContent = '';
    el.statsBody.replaceChildren(h('div', { className: 'stats-empty', textContent: 'No clicks logged yet. Open some articles first.' }));
    return;
  }
  const day = (ts) => (ts ? new Date(ts).toLocaleDateString() : '—');
  el.statsSummary.textContent = `${countLabel(total, 'click')} · ${day(first)} – ${day(last)}`;

  const rows = top.map(([source, count], index) => h('tr', {}, [
    h('td', { textContent: String(index + 1) }),
    h('td', { textContent: source, title: source }),
    h('td', { textContent: String(count) })
  ]));
  el.statsBody.replaceChildren(h('table', { className: 'stats-table' }, [
    h('thead', {}, [h('tr', {}, [
      h('th', { textContent: '#' }),
      h('th', { textContent: 'Source' }),
      h('th', { textContent: 'Opens' })
    ])]),
    h('tbody', {}, rows)
  ]));
}

function renderSettings() {
  const { settings } = state;
  // Leave a field alone while the user is editing it
  if (document.activeElement !== el.batchSize) {
    el.batchSize.value = settings.batchSize;
  }
  if (document.activeElement !== el.priorityDomains) {
    el.priorityDomains.value = settings.priorityDomains.join('\n');
  }
  el.sortOrder.value = settings.sortOrder;
  el.groupTabs.checked = settings.groupTabs;

  const summary = [`${settings.batchSize} per batch`, settings.sortOrder === 'oldest' ? 'oldest first' : 'newest first'];
  if (settings.priorityDomains.length > 0) {
    summary.push(countLabel(settings.priorityDomains.length, 'priority domain'));
  }
  if (settings.groupTabs && !el.groupTabsRow.hidden) {
    summary.push('grouped');
  }
  el.settingsSummary.textContent = `Settings · ${summary.join(' · ')}`;
}

function renderMain() {
  const articles = orderedArticles();
  const count = articles.length;
  const openable = articles.filter(article => isOpenableUrl(article.url)).length;
  const busy = isJobActive();
  const { batchSize } = state.settings;

  const loaded = Boolean(state.syncedAt);
  el.articleCount.textContent = count > 0 ? countLabel(count, 'saved article') : loaded ? 'No saved articles' : 'Saved list not loaded';
  el.actions.hidden = count === 0;
  el.emptyState.hidden = count > 0 || busy || !loaded;

  const next = Math.min(batchSize, openable);
  const batches = batchCount(openable, batchSize);
  el.openBatchBtn.textContent = `⚡ Open ${countLabel(next, 'article')}`;
  el.openAllBtn.textContent = `Open all (${countLabel(batches, 'batch', 'batches')})`;
  el.openAllBtn.hidden = batches < 2;
  el.openBatchBtn.disabled = busy || openable === 0;
  el.openAllBtn.disabled = busy || openable === 0;
  el.exportBtn.disabled = count === 0;
  el.refreshBtn.disabled = busy || el.refreshBtn.classList.contains('btn-loading');

  renderSyncStatus();
  renderJob();
  renderArticleList(articles);
  renderStats();
}

function render() {
  if (!state.settings) {
    return;
  }
  const view = popupView(state);
  el.disconnectBtn.hidden = !state.token;

  if (view === 'notAuth' || view === 'expired') {
    showView('connect');
    el.connectMessage.textContent = view === 'expired'
      ? 'Feedly no longer accepts your token (developer tokens expire). Get a new one and paste it below.'
      : 'Paste your Feedly developer token to read your "Saved for later" list. It stays in this browser.';
    el.connectMessage.className = view === 'expired' ? 'status error' : 'status info';
    return;
  }
  if (view === 'loading') {
    showView('loading');
    return;
  }

  showView('main');
  renderSettings();
  renderMain();
}

let renderQueued = false;
function scheduleRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }
}

// =============================================================================
// Actions
// =============================================================================

async function refresh({ force = true, quiet = false } = {}) {
  try {
    const result = await send({ action: 'sync', force });
    if (!quiet && result.skipped === 'rate-limit') {
      showToast(ERROR_MESSAGES['rate-limit'], 'error');
    }
  } catch (error) {
    if (!quiet && error.kind !== 'auth') {
      showToast(errorMessage(error), 'error');
    }
  }
}

async function connect(event) {
  event.preventDefault();
  const token = el.tokenInput.value.trim();
  if (!token) {
    el.tokenInput.focus();
    return;
  }
  await withSpinner(el.connectBtn, async () => {
    try {
      await send({ action: 'connect', token });
      el.tokenInput.value = '';
      showToast('Connected to Feedly', 'success');
    } catch (error) {
      showToast(error.kind === 'auth' ? 'Feedly rejected this token. Check it and try again.' : errorMessage(error), 'error', 4000);
    }
  });
}

async function open(kind) {
  if (kind === 'all') {
    const openable = orderedArticles().filter(article => isOpenableUrl(article.url)).length;
    const batches = batchCount(openable, state.settings.batchSize);
    const confirmed = await confirmDialog({
      title: 'Open all articles?',
      message: `This opens ${countLabel(openable, 'article')} in ${countLabel(batches, 'batch', 'batches')} of ${state.settings.batchSize} and unsaves them. It keeps going if you close this popup.`,
      confirm: 'Open all'
    });
    if (!confirmed) {
      return;
    }
  }
  try {
    const result = await send({ action: 'open', kind });
    if (!result.started) {
      showToast('Nothing to open', 'info');
    }
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

async function disconnect() {
  const confirmed = await confirmDialog({
    title: 'Disconnect account?',
    message: 'The token and cached list are removed from this browser. Settings and the click log stay.',
    confirm: 'Disconnect'
  });
  if (confirmed) {
    await send({ action: 'disconnect' }).catch(error => showToast(errorMessage(error), 'error'));
  }
}

async function saveSettings(patch) {
  state.settings = await store.saveSettings({ ...state.settings, ...patch });
  render();
}

const saveBatchSizeSoon = debounce(() => saveSettings({ batchSize: el.batchSize.value }), SETTINGS_DEBOUNCE_MS);

function exportUrls() {
  const urls = orderedArticles().map(article => article.url).filter(isOpenableUrl);
  if (urls.length === 0) {
    showToast('No articles to export', 'error');
    return;
  }
  download(`feedly-saved-${new Date().toISOString().slice(0, 10)}.txt`, `${urls.join('\n')}\n`, 'text/plain');
  showToast(`Exported ${countLabel(urls.length, 'URL')}`, 'success');
}

function exportClickLog() {
  if (state.clickLog.length === 0) {
    showToast('No click history yet. Open some articles first.', 'info');
    return;
  }
  download('feedly-click-log.json', JSON.stringify(state.clickLog, null, 2), 'application/json');
  showToast(`Exported ${countLabel(state.clickLog.length, 'click')}`, 'success');
}

async function clearClickLog() {
  const confirmed = await confirmDialog({
    title: 'Clear click history?',
    message: 'This removes the local log used for stats. It can\'t be undone.',
    confirm: 'Clear'
  });
  if (confirmed) {
    await send({ action: 'clearClickLog' })
      .then(() => showToast('Click log cleared', 'success'))
      .catch(error => showToast(errorMessage(error), 'error'));
  }
}

function isEditable(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// =============================================================================
// Setup
// =============================================================================

function setupListeners() {
  el.connectForm.addEventListener('submit', connect);
  el.toggleTokenBtn.addEventListener('click', () => {
    const show = el.tokenInput.type === 'password';
    el.tokenInput.type = show ? 'text' : 'password';
    el.toggleTokenBtn.textContent = show ? '🙈' : '👁️';
    el.toggleTokenBtn.setAttribute('aria-pressed', String(show));
    el.toggleTokenBtn.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
  });
  el.getTokenBtn.addEventListener('click', () => browser.tabs.create({ url: 'https://feedly.com/i/console' }));
  el.goToFeedlyBtn.addEventListener('click', () => browser.tabs.create({ url: 'https://feedly.com/i/saved' }));

  el.openBatchBtn.addEventListener('click', () => open('batch'));
  el.openAllBtn.addEventListener('click', () => open('all'));
  el.cancelBtn.addEventListener('click', () => send({ action: 'cancel' }).catch(error => showToast(errorMessage(error), 'error')));
  el.refreshBtn.addEventListener('click', () => withSpinner(el.refreshBtn, () => refresh()));
  el.disconnectBtn.addEventListener('click', disconnect);

  el.batchSize.addEventListener('input', saveBatchSizeSoon);
  el.batchSize.addEventListener('change', () => saveSettings({ batchSize: el.batchSize.value }));
  el.sortOrder.addEventListener('change', () => saveSettings({ sortOrder: el.sortOrder.value }));
  // 'change' fires on blur, so typing doesn't reorder the list per keystroke
  el.priorityDomains.addEventListener('change', () => saveSettings({ priorityDomains: parsePriorityDomains(el.priorityDomains.value) }));
  el.groupTabs.addEventListener('change', () => saveSettings({ groupTabs: el.groupTabs.checked }));

  el.articles.addEventListener('toggle', render);
  el.stats.addEventListener('toggle', render);
  el.exportBtn.addEventListener('click', exportUrls);
  el.exportLogBtn.addEventListener('click', exportClickLog);
  el.clearLogBtn.addEventListener('click', clearClickLog);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'r' || event.repeat || event.ctrlKey || event.metaKey || event.altKey
      || isEditable(event.target) || el.dialog.open || el.views.main.hidden || el.refreshBtn.disabled) {
      return;
    }
    event.preventDefault();
    el.refreshBtn.click();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    const map = area === 'local'
      ? {
        [LOCAL.token]: 'token',
        [LOCAL.authError]: 'authError',
        [LOCAL.articles]: 'articles',
        [LOCAL.syncedAt]: 'syncedAt',
        [LOCAL.clickLog]: 'clickLog'
      }
      : { [SESSION.job]: 'job', [SESSION.sync]: 'syncStatus' };
    let changed = area === 'local' && LOCAL.settings in changes;
    for (const [key, field] of Object.entries(map)) {
      if (key in changes) {
        state[field] = changes[key].newValue ?? null;
        changed = true;
      }
    }
    if (changed) {
      // Normalize values the popup reads directly
      state.articles = Array.isArray(state.articles) ? state.articles : [];
      state.clickLog = Array.isArray(state.clickLog) ? state.clickLog : [];
      state.authError = state.authError === true;
      if (area === 'local' && LOCAL.settings in changes) {
        state.settings = normalizeSettings(changes[LOCAL.settings].newValue);
      }
      scheduleRender();
    }
  });
}

async function setupStaticInfo() {
  el.version.textContent = `v${browser.runtime.getManifest().version}`;
  el.groupTabsRow.hidden = typeof browser.tabs?.group !== 'function';
  try {
    const commands = await browser.commands?.getAll();
    const shortcut = commands?.find(command => command.name === 'open-next-batch')?.shortcut;
    if (shortcut) {
      el.shortcutHint.textContent = `Shortcut: ${shortcut} opens the next batch without this popup.`;
      el.shortcutHint.hidden = false;
    }
  } catch {
    // No commands API (Safari): no hint
  }
}

async function init() {
  setupListeners();
  const [token, authError, articles, syncedAt, settings, clickLog, job, syncStatus] = await Promise.all([
    store.getToken(),
    store.getAuthError(),
    store.getArticles(),
    store.getSyncedAt(),
    store.getSettings(),
    store.getClickLog(),
    store.getJob(),
    store.getSyncStatus()
  ]);
  Object.assign(state, { token, authError, articles, syncedAt, settings, clickLog, job, syncStatus });
  render();
  await setupStaticInfo();
  render();

  if (token && !authError && isStale(syncedAt) && !isJobActive()) {
    refresh({ force: false, quiet: true });
  }
}

init().catch((error) => {
  console.error('Popup failed to start:', error);
  showToast('Something went wrong. Reopen the popup.', 'error', 6000);
});
