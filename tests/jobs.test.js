import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import { createFeedlyClient } from '../src/background/feedly.js';
import { createJobs, JOB_WATCHDOG_ALARM, JobError } from '../src/background/jobs.js';
import { createSync } from '../src/background/sync.js';
import { slimEntry } from '../src/shared/core.js';
import { createStore, LOCAL } from '../src/shared/store.js';
import { createFakeBrowser } from './helpers/fake-browser.js';
import { createFakeFeedly, makeEntry, TOKEN, USER_ID } from './helpers/fake-feedly.js';

// Expected failures are logged; keep the test output readable
beforeEach(() => {
  mock.restoreAll();
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
});

/**
 * Builds a connected extension with a fresh cache of `count` saved entries.
 * `onSleep` runs on every sleep, so tests can act between tabs and batches.
 */
async function setup({ count = 5, entries, settings = {}, tabGroups = true, onSleep, fresh = true } = {}) {
  const browser = createFakeBrowser({ tabGroups });
  const store = createStore(browser.storage);
  const feedly = createFakeFeedly({ entries: entries ?? Array.from({ length: count }, (_, i) => makeEntry(i + 1)) });
  const clock = { now: 5_000_000 };
  const sleeps = [];
  const client = createFeedlyClient({ getToken: () => store.getToken(), fetchImpl: feedly.fetch, sleep: async () => {}, maxRetries: 0 });
  const sync = createSync({ client, store, now: () => clock.now });
  let ids = 0;

  const make = () => createJobs({
    browser,
    client,
    store,
    sync,
    now: () => clock.now,
    uuid: () => `job-${++ids}`,
    sleep: async (ms) => {
      sleeps.push(ms);
      await onSleep?.(ms);
    }
  });

  browser.storage.local.data.set(LOCAL.token, TOKEN);
  browser.storage.local.data.set(LOCAL.userId, USER_ID);
  await store.saveSettings(settings);
  if (fresh) {
    await store.setArticles(feedly.saved.map(slimEntry), clock.now);
  }
  const jobs = make();
  return { browser, store, feedly, jobs, make, sleeps, clock };
}

/** Starts a job and waits until it finishes */
async function run(jobs, kind) {
  const job = await jobs.start(kind);
  await jobs.resume();
  return job;
}

describe('jobs: open next batch', () => {
  it('opens one batch in background tabs, unsaves it, and logs clicks', async () => {
    const { browser, store, feedly, jobs } = await setup({ count: 5, settings: { batchSize: 3 } });
    await run(jobs, 'batch');

    assert.deepEqual(browser.tabs.created.map(tab => tab.url), [1, 2, 3].map(n => `https://example.com/article-${n}`));
    assert.ok(browser.tabs.created.every(tab => tab.active === false && tab.windowId === 1));
    assert.deepEqual(feedly.callsTo('markers').map(call => call.body.entryIds), [['entry-1', 'entry-2', 'entry-3']]);
    assert.deepEqual((await store.getArticles()).map(a => a.id), ['entry-4', 'entry-5']);
    assert.equal((await store.getClickLog()).length, 3);

    const job = await store.getJob();
    assert.equal(job.status, 'done');
    assert.equal(job.opened, 3);
    assert.equal(browser.alarms.all.has(JOB_WATCHDOG_ALARM), false, 'watchdog cleared');
  });

  it('follows the sort order and priority domains', async () => {
    const entries = [
      makeEntry(1),
      makeEntry(2, { canonicalUrl: 'https://www.ilpost.it/a' }),
      makeEntry(3)
    ];
    const { browser, jobs } = await setup({ entries, settings: { batchSize: 2, sortOrder: 'oldest', priorityDomains: ['ilpost.it'] } });
    await run(jobs, 'batch');
    assert.deepEqual(browser.tabs.created.map(tab => tab.url), ['https://www.ilpost.it/a', 'https://example.com/article-3']);
  });

  it('skips articles without an openable link', async () => {
    const entries = [makeEntry(1, { canonicalUrl: 'javascript:alert(1)', alternate: [] }), makeEntry(2)];
    const { browser, feedly, store, jobs } = await setup({ entries });
    await run(jobs, 'batch');
    assert.deepEqual(browser.tabs.created.map(tab => tab.url), ['https://example.com/article-2']);
    assert.deepEqual(feedly.callsTo('markers')[0].body.entryIds, ['entry-2']);
    assert.deepEqual((await store.getArticles()).map(a => a.id), ['entry-1'], 'unopenable article stays saved');
  });

  it('returns null when there is nothing to open', async () => {
    const { jobs, browser } = await setup({ count: 0 });
    assert.equal(await jobs.start('batch'), null);
    assert.equal(browser.tabs.created.length, 0);
  });

  it('refreshes a stale list before choosing articles', async () => {
    const { jobs, feedly, browser } = await setup({ count: 2, fresh: false });
    await run(jobs, 'batch');
    assert.equal(feedly.callsTo('ids').length, 1);
    assert.equal(browser.tabs.created.length, 2);
  });

  it('refuses a second job while one runs', async () => {
    const ctx = await setup({
      count: 4,
      onSleep: async () => {
        await assert.rejects(ctx.jobs.start('batch'), (error) => error instanceof JobError && error.code === 'busy');
      }
    });
    await run(ctx.jobs, 'batch');
    assert.equal(ctx.browser.tabs.created.length, 4);
  });

  it('stops when a batch cannot be unsaved, keeping those articles cached', async () => {
    const { browser, feedly, store, jobs } = await setup({ count: 6, settings: { batchSize: 2 } });
    // The list is fresh, so the first Feedly call is the markers one
    feedly.failures.push(new Response('', { status: 503 }));
    await run(jobs, 'all');
    const job = await store.getJob();
    assert.equal(job.status, 'failed');
    assert.equal(job.unsaveFailed, 2);
    assert.equal(job.error.kind, 'server');
    assert.equal(browser.tabs.created.length, 2, 'no further batches open');
    assert.equal((await store.getArticles()).length, 6);
    assert.equal(await jobs.isActive(), false);
  });

  it('flags the token when Feedly rejects the unsave', async () => {
    const { feedly, store, jobs } = await setup({ count: 2 });
    feedly.failures.push(new Response('', { status: 401 }));
    await run(jobs, 'batch');
    assert.equal((await store.getJob()).status, 'failed');
    assert.equal(await store.getAuthError(), true);
  });

  it('refuses to start while the token is flagged', async () => {
    const { browser, store, jobs } = await setup({ count: 2 });
    await store.setAuthError(true);
    await assert.rejects(jobs.start('batch'), { kind: 'auth' });
    assert.equal(browser.tabs.created.length, 0);
  });

  it('refuses to start when the refresh before it is rejected, even with a cache', async () => {
    const { browser, store, jobs, clock } = await setup({ count: 2 });
    clock.now += 10 * 60 * 1000;
    browser.storage.local.data.set(LOCAL.token, 'expired');
    await assert.rejects(jobs.start('batch'), { kind: 'auth' });
    assert.equal(browser.tabs.created.length, 0);
    assert.equal(await store.getAuthError(), true);
  });

  it('starts from the cached list when the refresh before it is offline', async () => {
    const { browser, feedly, jobs, clock } = await setup({ count: 2 });
    clock.now += 10 * 60 * 1000;
    feedly.failures.push(new TypeError('NetworkError'));
    const job = await jobs.start('batch');
    assert.ok(job);
    await jobs.resume();
    assert.equal(browser.tabs.created.length, 2);
  });

  it('clears a leftover watchdog alarm when there is no job', async () => {
    const { browser, jobs } = await setup({ count: 0 });
    await browser.alarms.create(JOB_WATCHDOG_ALARM, { periodInMinutes: 1 });
    await jobs.resume();
    assert.equal(browser.alarms.all.has(JOB_WATCHDOG_ALARM), false);
  });
});

describe('jobs: open all', () => {
  it('works through every batch, unsaving after each', async () => {
    const { browser, feedly, store, jobs, sleeps } = await setup({ count: 7, settings: { batchSize: 3 } });
    await run(jobs, 'all');
    assert.equal(browser.tabs.created.length, 7);
    assert.deepEqual(feedly.callsTo('markers').map(call => call.body.entryIds.length), [3, 3, 1]);
    assert.equal((await store.getArticles()).length, 0);
    assert.equal(sleeps.filter(ms => ms === 1000).length, 2, 'cooldown between batches only');
  });

  it('stops after the current tab when cancelled, still unsaving what opened', async () => {
    let cancelled = false;
    const ctx = await setup({
      count: 6,
      settings: { batchSize: 3 },
      onSleep: async () => {
        if (!cancelled && ctx.browser.tabs.created.length === 2) {
          cancelled = true;
          assert.equal(await ctx.jobs.cancel(), true);
        }
      }
    });
    await run(ctx.jobs, 'all');

    assert.equal(ctx.browser.tabs.created.length, 2);
    assert.deepEqual(ctx.feedly.callsTo('markers').map(call => call.body.entryIds), [['entry-1', 'entry-2']]);
    const job = await ctx.store.getJob();
    assert.equal(job.status, 'cancelled');
    assert.equal(job.opened, 2);
    assert.equal(await ctx.jobs.isActive(), false);
    assert.equal(await ctx.jobs.cancel(), false, 'nothing left to cancel');
  });

  it('resumes after a suspension without reopening anything', async () => {
    const { browser, feedly, store, make } = await setup({ count: 5, settings: { batchSize: 2 } });
    const articles = await store.getArticles();
    // State a suspended background leaves behind: entry-1 and entry-2 opened, not yet unsaved
    await store.setJob({
      id: 'job-old',
      kind: 'all',
      batchSize: 2,
      groupTabs: false,
      total: 5,
      queue: articles.slice(2),
      opened: 2,
      skipped: 0,
      unsaveFailed: 0,
      pendingUnsave: ['entry-1', 'entry-2'],
      windowId: 1,
      groupId: null,
      status: 'running',
      error: null,
      startedAt: 1,
      finishedAt: null
    });

    await make().resume();

    assert.deepEqual(feedly.callsTo('markers').map(call => call.body.entryIds), [['entry-1', 'entry-2'], ['entry-3', 'entry-4'], ['entry-5']]);
    assert.deepEqual(browser.tabs.created.map(tab => tab.url), [3, 4, 5].map(n => `https://example.com/article-${n}`));
    const job = await store.getJob();
    assert.equal(job.status, 'done');
    assert.equal(job.opened, 5);
  });

  it('finishes a job that was cancelled while suspended', async () => {
    const { store, make, browser } = await setup({ count: 3 });
    await store.setJob({
      id: 'job-old', kind: 'all', batchSize: 1, groupTabs: false, total: 3, queue: (await store.getArticles()).slice(1),
      opened: 1, skipped: 0, unsaveFailed: 0, pendingUnsave: ['entry-1'], windowId: 1, groupId: null,
      status: 'cancelling', error: null, startedAt: 1, finishedAt: null
    });
    await make().resume();
    assert.equal((await store.getJob()).status, 'cancelled');
    assert.equal(browser.tabs.created.length, 0);
  });

  it('carries on in another window when the job\'s window closes', async () => {
    const { browser, jobs } = await setup({ count: 2 });
    browser.tabs.failWhen = (props) => props.windowId === 1;
    browser.windows.currentId = 2;
    await run(jobs, 'batch');
    assert.deepEqual(browser.tabs.created.map(tab => tab.windowId), [2, 2]);
    assert.equal(console.warn.mock.callCount(), 1, 'falls back once, then stays in the new window');
  });
});

describe('jobs: tab groups', () => {
  it('groups each job\'s tabs into one named group', async () => {
    const { browser, jobs } = await setup({ count: 5, settings: { batchSize: 2, groupTabs: true } });
    await run(jobs, 'all');
    assert.equal(browser.tabs.groups.length, 1);
    const [group] = browser.tabs.groups;
    assert.equal(group.tabIds.length, 5);
    assert.equal(group.windowId, 1);
    assert.match(group.title, /^Feedly · /);
  });

  it('starts a new group when the user closed the old one', async () => {
    const { browser, jobs } = await setup({ count: 4, settings: { batchSize: 2, groupTabs: true } });
    const originalGroup = browser.tabs.group;
    let calls = 0;
    browser.tabs.group = async (options) => {
      calls++;
      if (options.groupId !== undefined) {
        throw new Error('No group with id');
      }
      return originalGroup(options);
    };
    await run(jobs, 'all');
    assert.equal(browser.tabs.groups.length, 2);
    assert.equal(calls, 3);
  });

  it('opens tabs ungrouped when grouping fails', async () => {
    const { browser, jobs, store } = await setup({ count: 2, settings: { groupTabs: true } });
    browser.tabs.failGroup = true;
    await run(jobs, 'batch');
    assert.equal(browser.tabs.created.length, 2);
    assert.equal((await store.getJob()).status, 'done');
  });

  it('does not group when the setting is off', async () => {
    const { browser, jobs } = await setup({ count: 2 });
    await run(jobs, 'batch');
    assert.equal(browser.tabs.groups.length, 0);
  });

  it('ignores the setting where tab groups do not exist', async () => {
    const { browser, jobs, store } = await setup({ count: 2, tabGroups: false, settings: { groupTabs: true } });
    await run(jobs, 'batch');
    assert.equal(browser.tabs.created.length, 2);
    assert.equal((await store.getJob()).groupTabs, false);
  });
});
