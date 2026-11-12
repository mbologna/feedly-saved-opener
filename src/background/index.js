/**
 * Feedly Saved Opener - background entry point.
 *
 * Runs as an event page (Firefox, Safari) or a service worker (Chromium), so it
 * may be suspended at any time: every listener is registered synchronously at
 * the top level, and all state lives in storage.
 */

import { countLabel } from '../shared/core.js';
import { createStore, LOCAL, SESSION } from '../shared/store.js';
import { renderBadge } from './badge.js';
import { createFeedlyClient } from './feedly.js';
import { createJobs, JobError, JOB_WATCHDOG_ALARM } from './jobs.js';
import { createSync } from './sync.js';

const SYNC_ALARM = 'sync';
const SYNC_PERIOD_MINUTES = 15;

const MENU = Object.freeze({
  openBatch: 'open-next-batch',
  openAll: 'open-all',
  refresh: 'refresh'
});

const store = createStore(browser.storage);
const client = createFeedlyClient({ getToken: () => store.getToken() });
const sync = createSync({ client, store, isBusy: () => jobs.isActive() });
const jobs = createJobs({ browser, client, store, sync });

/** Stops a running job and waits until its opened tabs are unsaved. */
async function stopJob() {
  await jobs.cancel();
  await jobs.idle();
}

// =============================================================================
// Helpers
// =============================================================================

async function ensureSyncAlarm() {
  if (!(await browser.alarms.get(SYNC_ALARM))) {
    await browser.alarms.create(SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

/** Background refresh; errors are only logged. Sync skips itself during a job. */
async function syncQuietly() {
  try {
    await sync.sync();
  } catch (error) {
    console.warn('Sync failed:', error);
  }
}

async function refreshBadge() {
  const [token, authError, articles, job] = await Promise.all([
    store.getToken(),
    store.getAuthError(),
    store.getArticles(),
    store.getJob()
  ]);
  await renderBadge(browser.action, { token, authError, count: articles.length, job });
  await updateMenuTitles(articles.length);
}

async function createMenus() {
  if (!browser.contextMenus) {
    return;
  }
  try {
    await browser.contextMenus.removeAll();
    const items = [
      { id: MENU.openBatch, title: 'Open next batch' },
      { id: MENU.openAll, title: 'Open all saved articles' },
      { id: MENU.refresh, title: 'Refresh saved list' }
    ];
    for (const item of items) {
      browser.contextMenus.create({ ...item, contexts: ['action'] });
    }
  } catch (error) {
    // Safari may not offer menus on the toolbar button; the popup covers everything
    console.warn('Toolbar menu unavailable:', error);
  }
}

async function updateMenuTitles(count) {
  if (!browser.contextMenus) {
    return;
  }
  const { batchSize } = await store.getSettings();
  try {
    await browser.contextMenus.update(MENU.openBatch, {
      title: count > 0 ? `Open next ${countLabel(Math.min(batchSize, count), 'article')}` : 'Open next batch',
      enabled: count > 0
    });
    await browser.contextMenus.update(MENU.openAll, {
      title: count > 0 ? `Open all ${countLabel(count, 'saved article')}` : 'Open all saved articles',
      enabled: count > 0
    });
  } catch {
    // Menus not created (yet) in this browser
  }
}

/**
 * Starts a job from the shortcut or the toolbar menu, where there is no UI to
 * report to: a busy job is ignored and failures show up on the badge.
 * @param {'batch'|'all'} kind
 */
async function openFromShortcut(kind) {
  try {
    await jobs.start(kind);
  } catch (error) {
    if (!(error instanceof JobError)) {
      console.error('Could not open articles:', error);
    }
  }
}

// =============================================================================
// Messages from the popup
// =============================================================================

const handlers = {
  async sync({ force = false }) {
    return sync.sync({ force });
  },

  async connect({ token }) {
    const trimmed = String(token ?? '').trim();
    if (!trimmed) {
      throw new Error('Paste a token first');
    }
    // Check the token before storing it, so a typo never looks like a login
    const probe = createFeedlyClient({ getToken: async () => trimmed, maxRetries: 1 });
    const { id } = await probe.profile();
    if (id !== await store.getUserId()) {
      await stopJob();
      await store.disconnect();
    }
    await store.connect(trimmed, id);
    await ensureSyncAlarm();
    return sync.sync({ force: true });
  },

  async disconnect() {
    await stopJob();
    await store.disconnect();
    return {};
  },

  async open({ kind }) {
    if (kind !== 'batch' && kind !== 'all') {
      throw new Error(`Unknown kind: ${kind}`);
    }
    const job = await jobs.start(kind);
    return { started: Boolean(job), total: job?.total ?? 0 };
  },

  async cancel() {
    return { cancelled: await jobs.cancel() };
  },

  async clearClickLog() {
    await store.clearClickLog();
    return {};
  }
};

browser.runtime.onMessage.addListener(async (message) => {
  const handler = handlers[message?.action];
  if (!handler) {
    return { error: `Unknown action: ${message?.action}`, kind: 'unknown' };
  }
  try {
    return { ok: true, ...(await handler(message)) };
  } catch (error) {
    console.error(`${message.action} failed:`, error);
    return { error: error.message, kind: error.kind ?? error.code ?? 'unknown' };
  }
});

// =============================================================================
// Browser events
// =============================================================================

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'update') {
    await store.migrate();
  }
  await createMenus();
  await ensureSyncAlarm();
  await refreshBadge();
  await syncQuietly();
});

browser.runtime.onStartup.addListener(async () => {
  await createMenus();
  await ensureSyncAlarm();
  await refreshBadge();
  await syncQuietly();
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    syncQuietly();
  } else if (alarm.name === JOB_WATCHDOG_ALARM) {
    jobs.resume();
  }
});

browser.contextMenus?.onClicked.addListener((info) => {
  if (info.menuItemId === MENU.openBatch) {
    openFromShortcut('batch');
  } else if (info.menuItemId === MENU.openAll) {
    openFromShortcut('all');
  } else if (info.menuItemId === MENU.refresh) {
    sync.sync({ force: true }).catch(error => console.warn('Refresh failed:', error));
  }
});

browser.commands?.onCommand.addListener((command) => {
  if (command === 'open-next-batch') {
    openFromShortcut('batch');
  } else if (command === 'open-all') {
    openFromShortcut('all');
  }
});

// Redraw the badge and menu when the count, account or job status changes; job
// progress writes (one per tab) don't count
browser.storage.onChanged.addListener((changes, area) => {
  const localChange = area === 'local'
    && [LOCAL.articles, LOCAL.token, LOCAL.authError, LOCAL.settings].some(key => key in changes);
  const job = changes[SESSION.job];
  const jobChange = area === 'session' && job && job.oldValue?.status !== job.newValue?.status;
  if (localChange || jobChange) {
    refreshBadge().catch(error => console.warn('Badge update failed:', error));
  }
});

// A wake after suspension continues an unfinished job
jobs.resume();
