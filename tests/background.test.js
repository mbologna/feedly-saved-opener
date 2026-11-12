/**
 * Loads the real background entry point against the fake browser and Feedly,
 * and drives it the way the browser and the popup would.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';

import { createFakeBrowser } from './helpers/fake-browser.js';
import { createFakeFeedly, makeEntry, TOKEN } from './helpers/fake-feedly.js';

const browser = createFakeBrowser();
const feedly = createFakeFeedly({ entries: Array.from({ length: 4 }, (_, i) => makeEntry(i + 1)) });
const local = browser.storage.local.data;

const send = (message) => browser.runtime.onMessage.dispatch(message).then(([reply]) => reply);

async function waitFor(check, what) {
  for (let i = 0; i < 200; i++) {
    if (await check()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

before(async () => {
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
  globalThis.browser = browser;
  globalThis.fetch = feedly.fetch;
  // Leftovers from v2, to check the update migration
  local.set('cachedArticles', [{ id: 'old' }]);
  local.set('cacheTimestamp', 1);
  await import('../src/background/index.js');
});

after(() => {
  delete globalThis.browser;
  mock.restoreAll();
});

describe('background', () => {
  it('registers every listener at load', () => {
    for (const event of [
      browser.runtime.onMessage,
      browser.runtime.onInstalled,
      browser.runtime.onStartup,
      browser.alarms.onAlarm,
      browser.contextMenus.onClicked,
      browser.commands.onCommand,
      browser.storage.onChanged
    ]) {
      assert.equal(event.listeners.length, 1);
    }
  });

  it('on update: migrates, adds toolbar menus and the sync alarm', async () => {
    await browser.runtime.onInstalled.dispatch({ reason: 'update' });
    assert.equal(local.has('cachedArticles'), false);
    assert.equal(local.has('cacheTimestamp'), false);
    assert.deepEqual([...browser.contextMenus.items.keys()], ['open-next-batch', 'open-all', 'refresh']);
    assert.ok([...browser.contextMenus.items.values()].every(item => item.contexts.includes('action')));
    assert.equal(browser.alarms.all.get('sync').periodInMinutes, 15);
  });

  it('rejects unknown messages', async () => {
    assert.deepEqual(await send({ action: 'nope' }), { error: 'Unknown action: nope', kind: 'unknown' });
  });

  it('does not store a token Feedly rejects', async () => {
    const reply = await send({ action: 'connect', token: 'wrong' });
    assert.equal(reply.kind, 'auth');
    assert.equal(local.has('accessToken'), false);
  });

  it('connects with a good token and syncs', async () => {
    const reply = await send({ action: 'connect', token: `  ${TOKEN}\n` });
    assert.equal(reply.ok, true);
    assert.equal(reply.count, 4);
    assert.equal(local.get('accessToken'), TOKEN);
    await waitFor(() => browser.action.badge.text === '4', 'badge count');
    await waitFor(() => browser.contextMenus.items.get('open-all').title === 'Open all 4 saved articles', 'menu title');
  });

  it('opens a batch from the popup and counts down', async () => {
    local.set('userSettings', { batchSize: 3 });
    const reply = await send({ action: 'open', kind: 'batch' });
    assert.deepEqual(reply, { ok: true, started: true, total: 3 });
    await waitFor(() => browser.storage.session.data.get('job')?.status === 'done', 'job to finish');
    assert.equal(browser.tabs.created.length, 3);
    await waitFor(() => browser.action.badge.text === '1', 'badge to count down');
  });

  it('opens the next batch from the keyboard shortcut', async () => {
    await browser.commands.onCommand.dispatch('open-next-batch');
    await waitFor(() => browser.tabs.created.length === 4, 'the last tab');
    await waitFor(() => browser.action.badge.text === '', 'empty badge');
  });

  it('reports nothing to open', async () => {
    assert.deepEqual(await send({ action: 'open', kind: 'all' }), { ok: true, started: false, total: 0 });
  });

  it('disconnecting mid-run unsaves the tabs already open first', async () => {
    feedly.saved.push(makeEntry(5), makeEntry(6), makeEntry(7));
    assert.equal((await send({ action: 'sync', force: true })).count, 3);
    local.set('userSettings', { batchSize: 1 });
    await send({ action: 'open', kind: 'all' });
    await waitFor(() => browser.tabs.created.length === 5, 'the first tab of the run');
    assert.equal((await send({ action: 'disconnect' })).ok, true);
    assert.deepEqual(feedly.callsTo('markers').at(-1).body.entryIds, ['entry-5']);
    assert.ok(!feedly.saved.some(entry => entry.id === 'entry-5'));
    assert.equal(local.has('authError') && local.get('authError'), false);
  });

  it('disconnects, keeping settings', async () => {
    await send({ action: 'connect', token: TOKEN });
    assert.equal((await send({ action: 'disconnect' })).ok, true);
    assert.equal(local.has('accessToken'), false);
    assert.equal(local.has('articles'), false);
    assert.ok(local.has('userSettings'));
    await waitFor(() => browser.action.badge.text === '', 'cleared badge');
  });
});
