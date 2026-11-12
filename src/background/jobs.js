/**
 * Opens saved articles in background tabs, batch by batch, and unsaves each
 * batch once its tabs exist.
 *
 * The job lives in storage.session and is written after every tab, so when the
 * browser suspends the background mid-run, the next wake (or the watchdog alarm)
 * resumes it: ids already opened are unsaved first, so no article opens twice.
 * The popup only starts, watches and cancels jobs; closing it changes nothing.
 */

import { clickLogEntry, groupTitle, isOpenableUrl, isStale, orderArticles } from '../shared/core.js';
import { FeedlyError } from './feedly.js';

export const JOB_WATCHDOG_ALARM = 'job-watchdog';
export const ACTIVE_STATUSES = new Set(['running', 'cancelling']);

const TAB_DELAY_MS = 150;       // between tabs, so the browser isn't flooded
const BATCH_COOLDOWN_MS = 1000; // between batches of an "open all" job

export class JobError extends Error {
  /**
   * @param {string} message
   * @param {'busy'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {Object} deps
 * @param {Object} deps.browser - needs tabs, alarms; windows and tabGroups are optional
 * @param {ReturnType<import('./feedly.js').createFeedlyClient>} deps.client
 * @param {ReturnType<import('../shared/store.js').createStore>} deps.store
 * @param {ReturnType<import('./sync.js').createSync>} deps.sync
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {() => number} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createJobs({
  browser,
  client,
  store,
  sync,
  sleep = wait,
  now = Date.now,
  uuid = () => crypto.randomUUID()
}) {
  let runner = null;
  let starting = null;
  let cancelRequested = false;

  const canGroup = () => typeof browser.tabs.group === 'function';

  async function persist(job) {
    if (cancelRequested && job.status === 'running') {
      job.status = 'cancelling';
    }
    await store.setJob(job);
  }

  async function focusedWindowId() {
    try {
      const win = await browser.windows?.getLastFocused({ windowTypes: ['normal'] });
      return win?.id ?? null;
    } catch {
      return null;
    }
  }

  async function createTab(job, url) {
    if (job.windowId === null) {
      const tab = await browser.tabs.create({ url, active: false });
      job.windowId = tab.windowId ?? null;
      return tab;
    }
    try {
      return await browser.tabs.create({ url, active: false, windowId: job.windowId });
    } catch (error) {
      // The job's window was closed: carry on in whichever window is current
      console.warn('Window gone, opening in the current window:', error);
      job.windowId = null;
      job.groupId = null;
      return createTab(job, url);
    }
  }

  async function groupTabs(job, tabIds) {
    if (job.groupId !== null) {
      try {
        return await browser.tabs.group({ groupId: job.groupId, tabIds });
      } catch {
        // The user closed or ungrouped the job's group; start a new one
      }
    }
    try {
      const groupId = await browser.tabs.group({
        tabIds,
        ...(job.windowId !== null && { createProperties: { windowId: job.windowId } })
      });
      try {
        await browser.tabGroups?.update(groupId, { title: groupTitle(new Date(now())) });
      } catch (error) {
        console.warn('Could not name the tab group:', error);
      }
      return groupId;
    } catch (error) {
      console.warn('Could not group tabs:', error);
      return null;
    }
  }

  /**
   * Unsaves the opened ids. On failure the job stops: opening more articles that
   * can't be unsaved would only reopen them next time.
   */
  async function flushUnsave(job) {
    const ids = job.pendingUnsave;
    if (ids.length === 0) {
      return;
    }
    try {
      await client.unsave(ids);
      await store.removeArticles(ids);
    } catch (error) {
      console.error('Failed to unsave articles:', error);
      job.unsaveFailed += ids.length;
      job.error = { kind: error.kind ?? 'unknown', message: error.message };
      job.status = 'failed';
      if (error.kind === 'auth') {
        await store.setAuthError(true);
      }
    }
    job.pendingUnsave = [];
    await persist(job);
  }

  async function openBatch(job) {
    const batch = job.queue.slice(0, job.batchSize);
    const tabIds = [];
    const logEntries = [];

    for (const article of batch) {
      if (cancelRequested || job.status !== 'running') {
        break;
      }
      // A suspension between tabs.create and persist below reopens this one
      // article on resume; telling would need the "tabs" permission
      job.queue = job.queue.slice(1);
      try {
        const tab = await createTab(job, article.url);
        tabIds.push(tab.id);
        job.pendingUnsave.push(article.id);
        job.opened++;
        logEntries.push(clickLogEntry(article, now()));
      } catch (error) {
        console.error('Failed to open article:', article.id, error);
        job.skipped++;
      }
      await persist(job);
      await sleep(TAB_DELAY_MS);
    }

    if (job.groupTabs && tabIds.length > 0) {
      job.groupId = await groupTabs(job, tabIds);
    }
    await store.appendClickLog(logEntries);
    await flushUnsave(job);
  }

  async function finish(job) {
    if (job.status !== 'failed') {
      job.status = job.status === 'cancelling' ? 'cancelled' : 'done';
    }
    job.finishedAt = now();
    cancelRequested = false;
    await store.setJob(job);
    await browser.alarms.clear(JOB_WATCHDOG_ALARM);
  }

  async function loop() {
    const job = await store.getJob();
    if (!job || !ACTIVE_STATUSES.has(job.status)) {
      // Alarms can outlive storage.session across a browser restart
      await browser.alarms.clear(JOB_WATCHDOG_ALARM);
      return;
    }
    // Ids opened before a suspension are unsaved before anything else opens
    await flushUnsave(job);
    while (job.status === 'running' && !cancelRequested && job.queue.length > 0) {
      await openBatch(job);
      if (job.queue.length > 0 && job.status === 'running' && !cancelRequested) {
        await sleep(BATCH_COOLDOWN_MS);
      }
    }
    await persist(job);
    await finish(job);
  }

  async function createJob(kind) {
    const current = await store.getJob();
    if (current && ACTIVE_STATUSES.has(current.status)) {
      throw new JobError('Articles are already opening', 'busy');
    }

    if (await store.getAuthError()) {
      throw new FeedlyError('Feedly rejected the token', { kind: 'auth' });
    }
    // Shortcut and menu starts may find an old list; one ids request fixes that.
    // Offline, the cached list will do; a rejected token stops here.
    if (isStale(await store.getSyncedAt(), now())) {
      try {
        await sync.sync();
      } catch (error) {
        if (error.kind === 'auth' || !(await store.getSyncedAt())) {
          throw error;
        }
      }
    }

    const settings = await store.getSettings();
    const openable = orderArticles(await store.getArticles(), settings).filter(article => isOpenableUrl(article.url));
    const queue = kind === 'all' ? openable : openable.slice(0, settings.batchSize);
    if (queue.length === 0) {
      return null;
    }

    const job = {
      id: uuid(),
      kind,
      batchSize: settings.batchSize,
      groupTabs: settings.groupTabs && canGroup(),
      total: queue.length,
      queue,
      opened: 0,
      skipped: 0,
      unsaveFailed: 0,
      pendingUnsave: [],
      windowId: await focusedWindowId(),
      groupId: null,
      status: 'running',
      error: null,
      startedAt: now(),
      finishedAt: null
    };
    cancelRequested = false;
    await store.setJob(job);
    await browser.alarms.create(JOB_WATCHDOG_ALARM, { periodInMinutes: 1 });
    return job;
  }

  const jobs = {
    /**
     * Starts opening the next batch ('batch') or every saved article ('all').
     * Resolves once the job is recorded, not when it finishes.
     * @param {'batch'|'all'} kind
     * @returns {Promise<Object|null>} the job, or null when nothing can be opened
     * @throws {JobError} when a job is already running
     */
    async start(kind) {
      if (starting) {
        throw new JobError('Articles are already opening', 'busy');
      }
      starting = createJob(kind);
      try {
        const job = await starting;
        if (job) {
          jobs.resume();
        }
        return job;
      } finally {
        starting = null;
      }
    },

    /**
     * Continues a recorded job, if any. Safe to call often: only one loop runs.
     * @returns {Promise<void>}
     */
    resume() {
      runner ??= loop()
        .catch(error => console.error('Job failed:', error))
        .finally(() => {
          runner = null;
        });
      return runner;
    },

    /**
     * Stops after the current tab. Tabs already open are still unsaved. Use
     * idle() to wait until that has happened.
     * @returns {Promise<boolean>} whether a job was running
     */
    async cancel() {
      if (runner) {
        // The running loop owns the job record and saves the new status itself
        cancelRequested = true;
        return true;
      }
      const job = await store.getJob();
      if (!job || !ACTIVE_STATUSES.has(job.status)) {
        return false;
      }
      cancelRequested = true;
      job.status = 'cancelling';
      await store.setJob(job);
      jobs.resume();
      return true;
    },

    /** @returns {Promise<void>} resolves when no job loop is running */
    idle() {
      return runner ?? Promise.resolve();
    },

    async isActive() {
      const job = await store.getJob();
      return Boolean(job && ACTIVE_STATUSES.has(job.status));
    }
  };

  return jobs;
}
