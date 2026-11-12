import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { createFeedlyClient } from '../src/background/feedly.js';
import { createSync } from '../src/background/sync.js';
import { createStore, LOCAL } from '../src/shared/store.js';
import { createFakeBrowser } from './helpers/fake-browser.js';
import { createFakeFeedly, makeEntry, TOKEN, USER_ID } from './helpers/fake-feedly.js';

let browser;
let store;
let feedly;
let clock;
let sync;

function setup(entries, { connected = true, userId = USER_ID } = {}) {
  browser = createFakeBrowser();
  store = createStore(browser.storage);
  feedly = createFakeFeedly({ entries });
  clock = 1_000_000;
  const client = createFeedlyClient({ getToken: () => store.getToken(), fetchImpl: feedly.fetch, sleep: async () => {}, maxRetries: 0 });
  sync = createSync({ client, store, now: () => clock });
  if (connected) {
    browser.storage.local.data.set(LOCAL.token, TOKEN);
    if (userId) {
      browser.storage.local.data.set(LOCAL.userId, userId);
    }
  }
}

describe('sync', () => {
  beforeEach(() => setup([makeEntry(1), makeEntry(2), makeEntry(3)]));

  it('first run fetches ids and every entry, and caches slim articles', async () => {
    assert.deepEqual(await sync.sync(), { count: 3, fetched: 3 });
    const articles = await store.getArticles();
    assert.deepEqual(articles.map(a => a.id), ['entry-1', 'entry-2', 'entry-3']);
    assert.deepEqual(Object.keys(articles[0]).sort(), ['feedId', 'id', 'source', 'title', 'url']);
    assert.equal(await store.getSyncedAt(), clock);
    assert.equal(feedly.callsTo('ids').length, 1);
    assert.equal(feedly.callsTo('mget').length, 1);
  });

  it('later runs fetch only new entries and drop removed ones', async () => {
    await sync.sync();
    feedly.saved.splice(1, 1); // entry-2 unsaved elsewhere
    feedly.saved.unshift(makeEntry(9));
    clock += 60_000;
    assert.deepEqual(await sync.sync(), { count: 3, fetched: 1 });
    assert.deepEqual((await store.getArticles()).map(a => a.id), ['entry-9', 'entry-1', 'entry-3']);
    assert.deepEqual(feedly.callsTo('mget')[1].body, ['entry-9']);
  });

  it('makes a single request when nothing changed', async () => {
    await sync.sync();
    const before = feedly.calls.length;
    await sync.sync();
    assert.equal(feedly.calls.length - before, 1);
  });

  it('looks up and stores the user id when missing', async () => {
    setup([makeEntry(1)], { userId: null });
    await sync.sync();
    assert.equal(feedly.callsTo('profile').length, 1);
    assert.equal(await store.getUserId(), USER_ID);
  });

  it('shares one run between concurrent callers', async () => {
    const [a, b] = await Promise.all([sync.sync(), sync.sync()]);
    assert.equal(a, b);
    assert.equal(feedly.callsTo('ids').length, 1);
  });

  it('skips when not connected', async () => {
    setup([makeEntry(1)], { connected: false });
    assert.deepEqual(await sync.sync(), { skipped: 'not-connected' });
    assert.equal(feedly.calls.length, 0);
  });

  it('keeps the cache and records the error when offline', async () => {
    await sync.sync();
    feedly.failures.push(new TypeError('NetworkError when attempting to fetch resource.'));
    clock += 60_000;
    await assert.rejects(sync.sync(), { kind: 'network' });
    assert.equal((await store.getArticles()).length, 3);
    const status = await store.getSyncStatus();
    assert.equal(status.running, false);
    assert.equal(status.lastError.kind, 'network');
    assert.equal(status.lastError.at, clock);
  });

  it('flags an expired token', async () => {
    browser.storage.local.data.set(LOCAL.token, 'expired');
    await assert.rejects(sync.sync(), { kind: 'auth' });
    assert.equal(await store.getAuthError(), true);
  });

  it('clears the auth flag after a good sync', async () => {
    await store.setAuthError(true);
    await sync.sync();
    assert.equal(await store.getAuthError(), false);
  });

  it('skips while a job is opening articles', async () => {
    const client = createFeedlyClient({ getToken: () => store.getToken(), fetchImpl: feedly.fetch, maxRetries: 0 });
    const busySync = createSync({ client, store, isBusy: async () => true });
    assert.deepEqual(await busySync.sync({ force: true }), { skipped: 'job-running' });
    assert.equal(feedly.calls.length, 0);
  });

  it('drops its result when a job started while it ran', async () => {
    let busy = false;
    const client = createFeedlyClient({
      getToken: () => store.getToken(),
      fetchImpl: async (...args) => {
        busy = true; // a job starts once the ids request is out
        return feedly.fetch(...args);
      },
      maxRetries: 0
    });
    const racingSync = createSync({ client, store, isBusy: async () => busy });
    assert.deepEqual(await racingSync.sync(), { skipped: 'job-running' });
    assert.deepEqual(await store.getArticles(), []);
    assert.equal((await store.getSyncStatus()).running, false);
  });

  it('backs off after a rate limit until forced', async () => {
    feedly.failures.push(new Response('', { status: 429, headers: { 'X-Ratelimit-Reset': '600' } }));
    await assert.rejects(sync.sync(), { kind: 'rate-limit' });
    assert.equal((await store.getSyncStatus()).rateLimitedUntil, clock + 600_000);

    assert.deepEqual(await sync.sync(), { skipped: 'rate-limit' });
    assert.equal((await sync.sync({ force: true })).count, 3);
    assert.equal((await store.getSyncStatus()).rateLimitedUntil, 0);
  });
});
