import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_SETTINGS } from '../src/shared/core.js';
import { createStore, LEGACY_KEYS, LOCAL, SESSION } from '../src/shared/store.js';
import { createFakeBrowser } from './helpers/fake-browser.js';

function setup() {
  const browser = createFakeBrowser();
  return { browser, store: createStore(browser.storage), local: browser.storage.local.data, session: browser.storage.session.data };
}

describe('store', () => {
  it('returns safe defaults on an empty profile', async () => {
    const { store } = setup();
    assert.equal(await store.getToken(), undefined);
    assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);
    assert.deepEqual(await store.getArticles(), []);
    assert.deepEqual(await store.getClickLog(), []);
    assert.equal(await store.getSyncedAt(), null);
    assert.equal(await store.getAuthError(), false);
    assert.equal(await store.getJob(), null);
    assert.deepEqual(await store.getSyncStatus(), { running: false, lastError: null, rateLimitedUntil: 0 });
  });

  it('normalizes settings on save', async () => {
    const { store, local } = setup();
    const saved = await store.saveSettings({ batchSize: 999, sortOrder: 'oldest', priorityDomains: ['https://www.ilpost.it/'] });
    assert.deepEqual(saved, { batchSize: 100, sortOrder: 'oldest', priorityDomains: ['ilpost.it'], groupTabs: false });
    assert.deepEqual(local.get(LOCAL.settings), saved);
  });

  it('removes opened articles from the cache', async () => {
    const { store } = setup();
    await store.setArticles([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 1);
    await store.removeArticles(['a', 'c']);
    assert.deepEqual(await store.getArticles(), [{ id: 'b' }]);
    assert.equal(await store.getSyncedAt(), 1, 'removal keeps the sync time');
  });

  it('appends to the click log with one write and a cap', async () => {
    const { store, local } = setup();
    local.set(LOCAL.clickLog, Array.from({ length: 499 }, (_, i) => ({ n: i })));
    await store.appendClickLog([{ n: 499 }, { n: 500 }]);
    const log = await store.getClickLog();
    assert.equal(log.length, 500);
    assert.deepEqual(log.at(-1), { n: 500 });
    await store.appendClickLog([]);
    assert.equal((await store.getClickLog()).length, 500);
  });

  it('disconnect forgets the account but keeps settings and the click log', async () => {
    const { store, local, session } = setup();
    await store.connect('token', 'user');
    await store.saveSettings({ batchSize: 10 });
    await store.setArticles([{ id: 'a' }], 1);
    await store.appendClickLog([{ n: 1 }]);
    await store.setJob({ status: 'done' });
    await store.setSyncStatus({ running: true });

    await store.disconnect();

    assert.deepEqual([...local.keys()].sort(), [LOCAL.clickLog, LOCAL.settings].sort());
    assert.equal(session.has(SESSION.job), false);
    assert.equal(session.has(SESSION.sync), false);
  });
});

describe('migration from v2', () => {
  it('drops the old full-entry cache and keeps account, settings and log', async () => {
    const { store, local } = setup();
    // What v2.1.x leaves in storage
    local.set('accessToken', 'token');
    local.set('userId', 'user');
    local.set('userSettings', { batchSize: 25, sortOrder: 'oldest', priorityDomains: ['ilpost.it'] });
    local.set('clickLog', [{ url: 'https://x.com', feedTitle: 'X', feedId: null, timestamp: 1 }]);
    local.set('cachedArticles', [{ id: 'e', content: { content: '<p>big</p>' } }]);
    local.set('cacheTimestamp', 123);
    local.set('cachedBadgeCount', 1);

    await store.migrate();

    for (const key of LEGACY_KEYS) {
      assert.equal(local.has(key), false, key);
    }
    assert.equal(await store.getToken(), 'token');
    assert.equal(await store.getUserId(), 'user');
    assert.deepEqual(local.get('userSettings'), { batchSize: 25, sortOrder: 'oldest', priorityDomains: ['ilpost.it'], groupTabs: false });
    assert.equal((await store.getClickLog()).length, 1);
  });
});
