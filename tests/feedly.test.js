import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFeedlyClient, FeedlyError, parseRetryAfter } from '../src/background/feedly.js';
import { createFakeFeedly, makeEntry, TOKEN, USER_ID } from './helpers/fake-feedly.js';

function setup({ entries = [], pageSize, token = TOKEN, maxRetries } = {}) {
  const feedly = createFakeFeedly({ entries, pageSize });
  const sleeps = [];
  const client = createFeedlyClient({
    getToken: async () => token,
    fetchImpl: feedly.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...(maxRetries !== undefined && { maxRetries })
  });
  return { feedly, client, sleeps };
}

const status = (code, headers = {}) => new Response('', { status: code, headers });

async function rejectsWith(promise, kind) {
  const error = await promise.then(() => assert.fail('expected a FeedlyError'), (err) => err);
  assert.ok(error instanceof FeedlyError, `got ${error}`);
  assert.equal(error.kind, kind);
  return error;
}

describe('FeedlyClient.request', () => {
  it('sends the token and parses JSON', async () => {
    const { feedly, client } = setup();
    assert.deepEqual(await client.profile(), { id: USER_ID, email: 'reader@example.com' });
    assert.equal(feedly.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(feedly.calls[0].headers['Content-Type'], undefined, 'no content type on GET');
  });

  it('returns null for an empty body', async () => {
    const { client } = setup({ entries: [makeEntry(1)] });
    assert.equal(await client.request('/markers', { method: 'POST', body: { action: 'x' } }), null);
  });

  it('fails without calling Feedly when there is no token', async () => {
    const { feedly, client } = setup({ token: null });
    await rejectsWith(client.profile(), 'auth');
    assert.equal(feedly.calls.length, 0);
  });

  it('does not retry a 401', async () => {
    const { feedly, client, sleeps } = setup({ token: 'expired' });
    const error = await rejectsWith(client.profile(), 'auth');
    assert.equal(error.status, 401);
    assert.equal(feedly.calls.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it('retries 5xx with exponential backoff', async () => {
    const { feedly, client, sleeps } = setup();
    feedly.failures.push(status(502), status(503));
    assert.equal((await client.profile()).id, USER_ID);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it('gives up on 5xx after the retries', async () => {
    const { feedly, client } = setup();
    feedly.failures.push(status(500), status(500), status(500), status(500));
    const error = await rejectsWith(client.profile(), 'server');
    assert.equal(error.status, 500);
    assert.equal(feedly.calls.length, 4);
  });

  it('retries the network errors Firefox and Chromium throw', async () => {
    const { feedly, client, sleeps } = setup();
    feedly.failures.push(
      new TypeError('NetworkError when attempting to fetch resource.'),
      new TypeError('Failed to fetch')
    );
    assert.equal((await client.profile()).id, USER_ID);
    assert.equal(sleeps.length, 2);
  });

  it('reports a network error after the retries', async () => {
    const { feedly, client } = setup({ maxRetries: 1 });
    feedly.failures.push(new TypeError('NetworkError'), new TypeError('NetworkError'));
    const error = await rejectsWith(client.profile(), 'network');
    assert.ok(error.cause instanceof TypeError);
  });

  it('reports a timeout', async () => {
    const { feedly, client } = setup({ maxRetries: 0 });
    feedly.failures.push(new DOMException('The operation timed out.', 'TimeoutError'));
    await rejectsWith(client.profile(), 'timeout');
  });

  it('waits out a short 429 using Retry-After', async () => {
    const { feedly, client, sleeps } = setup();
    feedly.failures.push(status(429, { 'Retry-After': '2' }));
    assert.equal((await client.profile()).id, USER_ID);
    assert.deepEqual(sleeps, [2000]);
  });

  it('reports a long 429 instead of sleeping', async () => {
    const { feedly, client, sleeps } = setup();
    feedly.failures.push(status(429, { 'X-Ratelimit-Reset': '3600' }));
    const error = await rejectsWith(client.profile(), 'rate-limit');
    assert.equal(error.retryAfterMs, 3600 * 1000);
    assert.deepEqual(sleeps, []);
  });

  it('reports other HTTP errors without retrying', async () => {
    const { feedly, client } = setup();
    feedly.failures.push(status(404));
    const error = await rejectsWith(client.profile(), 'http');
    assert.equal(error.status, 404);
    assert.equal(feedly.calls.length, 1);
  });

  it('reports an unreadable body', async () => {
    const { feedly, client } = setup();
    feedly.failures.push(new Response('<html>', { status: 200 }));
    await rejectsWith(client.profile(), 'server');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds, HTTP dates and Feedly\'s reset header', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    assert.equal(parseRetryAfter(new Headers({ 'Retry-After': '5' }), now), 5000);
    assert.equal(parseRetryAfter(new Headers({ 'Retry-After': 'Thu, 12 Nov 2026 10:00:30 GMT' }), now), 30000);
    assert.equal(parseRetryAfter(new Headers({ 'X-Ratelimit-Reset': '60' }), now), 60000);
    assert.equal(parseRetryAfter(new Headers(), now), null);
  });
});

describe('FeedlyClient endpoints', () => {
  it('follows continuation for saved ids, newest first', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(i));
    const { feedly, client } = setup({ entries, pageSize: 2 });
    assert.deepEqual(await client.savedIds(USER_ID), entries.map(entry => entry.id));
    const idCalls = feedly.callsTo('ids');
    assert.equal(idCalls.length, 3);
    assert.equal(idCalls[0].query.ranked, 'newest');
    assert.equal(idCalls[1].query.continuation, '2');
    assert.match(idCalls[0].path, /user%2Fuser-123%2Ftag%2Fglobal\.saved/);
  });

  it('fetches entries in chunks of 1000', async () => {
    const entries = Array.from({ length: 2500 }, (_, i) => makeEntry(i));
    const { feedly, client } = setup({ entries });
    const result = await client.entries(entries.map(entry => entry.id));
    assert.equal(result.length, 2500);
    assert.deepEqual(feedly.callsTo('mget').map(call => call.body.length), [1000, 1000, 500]);
  });

  it('unsaves with one markers call per 1000 ids', async () => {
    const entries = [makeEntry(1), makeEntry(2)];
    const { feedly, client } = setup({ entries });
    await client.unsave(['entry-1', 'entry-2']);
    assert.deepEqual(feedly.callsTo('markers')[0].body, { action: 'markAsUnsaved', type: 'entries', entryIds: ['entry-1', 'entry-2'] });
    assert.equal(feedly.calls[0].headers['Content-Type'], 'application/json');
    assert.equal(feedly.saved.length, 0);
  });
});
