import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateStats,
  appendCapped,
  badgeText,
  batchCount,
  chunk,
  clampBatchSize,
  clickLogEntry,
  countLabel,
  DEFAULT_SETTINGS,
  formatRelativeTime,
  getEntryUrl,
  groupTitle,
  isOpenableUrl,
  isStale,
  matchesDomain,
  normalizeDomain,
  normalizeSettings,
  orderArticles,
  parsePriorityDomains,
  popupView,
  prioritize,
  slimEntry
} from '../src/shared/core.js';
import { makeEntry } from './helpers/fake-feedly.js';

const article = (id, url, extra = {}) => ({ id, title: id, url, source: null, feedId: null, ...extra });

describe('getEntryUrl', () => {
  it('prefers canonicalUrl', () => {
    assert.equal(getEntryUrl(makeEntry(1)), 'https://example.com/article-1');
  });

  it('falls back to canonical[0], then alternate[0]', () => {
    assert.equal(getEntryUrl({ canonical: [{ href: 'https://c.example' }], alternate: [{ href: 'https://a.example' }] }), 'https://c.example');
    assert.equal(getEntryUrl({ alternate: [{ href: 'https://a.example' }] }), 'https://a.example');
  });

  it('returns undefined when there is no link', () => {
    assert.equal(getEntryUrl({}), undefined);
    assert.equal(getEntryUrl(null), undefined);
    assert.equal(getEntryUrl({ alternate: [] }), undefined);
  });
});

describe('isOpenableUrl', () => {
  it('accepts http and https', () => {
    assert.ok(isOpenableUrl('https://example.com/a'));
    assert.ok(isOpenableUrl('http://example.com'));
  });

  it('rejects other schemes, junk and non-strings', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'file:///etc/passwd', 'example.com', '', null, undefined, 42]) {
      assert.equal(isOpenableUrl(url), false, String(url));
    }
  });
});

describe('slimEntry', () => {
  it('keeps only what the extension uses', () => {
    assert.deepEqual(slimEntry(makeEntry(4)), {
      id: 'entry-4',
      title: 'Article 4',
      url: 'https://example.com/article-4',
      source: 'Feed 1',
      feedId: 'feed/https://example.com/feed-1'
    });
  });

  it('fills gaps and drops entries without an id', () => {
    assert.deepEqual(slimEntry({ id: 'x', title: '  ' }), { id: 'x', title: 'Untitled', url: null, source: null, feedId: null });
    assert.equal(slimEntry({ title: 'no id' }), null);
    assert.equal(slimEntry(undefined), null);
  });
});

describe('priority domains', () => {
  it('normalizes entries', () => {
    assert.equal(normalizeDomain('  https://www.IlPost.it/ '), 'ilpost.it');
    assert.equal(normalizeDomain('http://youtube.com/@chan/'), 'youtube.com/@chan');
  });

  it('parses one per line, dropping blanks and duplicates', () => {
    assert.deepEqual(parsePriorityDomains('ilpost.it\n\n  www.ilpost.it\nSlashdot.org\n'), ['ilpost.it', 'slashdot.org']);
    assert.deepEqual(parsePriorityDomains(''), []);
    assert.deepEqual(parsePriorityDomains(undefined), []);
  });

  it('matches a bare domain on the host and its subdomains only', () => {
    assert.ok(matchesDomain('https://www.ilpost.it/2026/x', 'ilpost.it'));
    assert.ok(matchesDomain('https://ilpost.it/', 'ilpost.it'));
    assert.equal(matchesDomain('https://notilpost.it/', 'ilpost.it'), false);
    assert.equal(matchesDomain('https://example.com/?ref=ilpost.it', 'ilpost.it'), false);
    assert.equal(matchesDomain(null, 'ilpost.it'), false);
  });

  it('matches an entry with a path as a substring', () => {
    assert.ok(matchesDomain('https://www.youtube.com/@chan/videos', 'youtube.com/@chan'));
    assert.equal(matchesDomain('https://www.youtube.com/@other', 'youtube.com/@chan'), false);
  });

  it('moves priority articles first, keeping order in both groups', () => {
    const list = [
      article('a', 'https://x.com/1'),
      article('b', 'https://ilpost.it/1'),
      article('c', 'https://y.com/1'),
      article('d', 'https://www.ilpost.it/2')
    ];
    assert.deepEqual(prioritize(list, ['ilpost.it']).map(a => a.id), ['b', 'd', 'a', 'c']);
    assert.equal(prioritize(list, []), list);
  });

  it('orders by setting on read: oldest reverses, then priority applies', () => {
    const list = [article('new', 'https://x.com'), article('mid', 'https://ilpost.it'), article('old', 'https://y.com')];
    const settings = { ...DEFAULT_SETTINGS, sortOrder: 'oldest', priorityDomains: ['ilpost.it'] };
    assert.deepEqual(orderArticles(list, settings).map(a => a.id), ['mid', 'old', 'new']);
    assert.deepEqual(list.map(a => a.id), ['new', 'mid', 'old'], 'input untouched');
  });
});

describe('settings', () => {
  it('clamps the batch size', () => {
    assert.equal(clampBatchSize(0), 1);
    assert.equal(clampBatchSize(-5), 1);
    assert.equal(clampBatchSize(500), 100);
    assert.equal(clampBatchSize('42'), 42);
    assert.equal(clampBatchSize(7.9), 7);
    assert.equal(clampBatchSize('abc'), 30);
  });

  it('fills defaults for missing or broken settings', () => {
    assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(normalizeSettings({ batchSize: 'x', sortOrder: 'random', priorityDomains: 'nope', groupTabs: 'yes' }), DEFAULT_SETTINGS);
  });

  it('keeps valid v2 settings and normalizes domains', () => {
    assert.deepEqual(normalizeSettings({ batchSize: 50, sortOrder: 'oldest', priorityDomains: ['WWW.ilpost.it', 'ilpost.it'] }), {
      batchSize: 50,
      sortOrder: 'oldest',
      priorityDomains: ['ilpost.it'],
      groupTabs: false
    });
  });
});

describe('click log and stats', () => {
  it('caps the log, keeping the newest entries', () => {
    const log = Array.from({ length: 499 }, (_, i) => ({ n: i }));
    const result = appendCapped(log, [{ n: 499 }, { n: 500 }], 500);
    assert.equal(result.length, 500);
    assert.deepEqual(result.at(0), { n: 1 });
    assert.deepEqual(result.at(-1), { n: 500 });
    assert.deepEqual(appendCapped(undefined, [{ n: 1 }]), [{ n: 1 }]);
  });

  it('records the exported entry shape', () => {
    assert.deepEqual(clickLogEntry(article('a', 'https://x.com', { source: 'X', feedId: 'feed/x' }), 5), {
      url: 'https://x.com', feedTitle: 'X', feedId: 'feed/x', timestamp: 5
    });
  });

  it('aggregates by feed title, falling back to the host', () => {
    const log = [
      { url: 'https://a.com/1', feedTitle: 'A', timestamp: 3000 },
      { url: 'https://a.com/2', feedTitle: 'A', timestamp: 1000 },
      { url: 'https://www.b.com/1', feedTitle: null, timestamp: 2000 },
      { url: 'not a url', feedTitle: null }
    ];
    assert.deepEqual(aggregateStats(log), {
      total: 4,
      first: 1000,
      last: 3000,
      top: [['A', 2], ['b.com', 1], ['not a url', 1]]
    });
    assert.deepEqual(aggregateStats([]), { total: 0, first: null, last: null, top: [] });
  });

  it('limits the top list', () => {
    const log = Array.from({ length: 15 }, (_, i) => ({ feedTitle: `F${i}` }));
    assert.equal(aggregateStats(log).top.length, 10);
  });
});

describe('formatting', () => {
  it('pluralizes counts', () => {
    assert.equal(countLabel(1, 'article'), '1 article');
    assert.equal(countLabel(0, 'article'), '0 articles');
    assert.equal(countLabel(2, 'batch', 'batches'), '2 batches');
  });

  it('counts batches', () => {
    assert.equal(batchCount(0, 30), 0);
    assert.equal(batchCount(30, 30), 1);
    assert.equal(batchCount(31, 30), 2);
  });

  it('formats relative times', () => {
    const now = 10 * 24 * 3600 * 1000;
    assert.equal(formatRelativeTime(null, now), '');
    assert.equal(formatRelativeTime(now - 30 * 1000, now), 'just now');
    assert.equal(formatRelativeTime(now - 60 * 1000, now), '1 minute ago');
    assert.equal(formatRelativeTime(now - 5 * 60 * 1000, now), '5 minutes ago');
    assert.equal(formatRelativeTime(now - 2 * 3600 * 1000, now), '2 hours ago');
    assert.equal(formatRelativeTime(now - 3 * 24 * 3600 * 1000, now), new Date(now - 3 * 24 * 3600 * 1000).toLocaleDateString());
  });

  it('formats badge text', () => {
    assert.equal(badgeText(0), '');
    assert.equal(badgeText(-1), '');
    assert.equal(badgeText(undefined), '');
    assert.equal(badgeText(42), '42');
    assert.equal(badgeText(999), '999');
    assert.equal(badgeText(1000), '999+');
  });

  it('names tab groups after the day', () => {
    assert.match(groupTitle(new Date(2026, 10, 12)), /^Feedly · .*12/);
  });

  it('chunks arrays', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });
});

describe('popup view model', () => {
  it('picks the view from stored state', () => {
    assert.equal(popupView({}), 'notAuth');
    assert.equal(popupView({ token: 't', authError: true, syncedAt: 1, articles: [{}] }), 'expired');
    assert.equal(popupView({ token: 't' }), 'loading');
    assert.equal(popupView({ token: 't', syncStatus: { running: true, lastError: { kind: 'network' } } }), 'loading');
    assert.equal(popupView({ token: 't', syncStatus: { running: false, lastError: { kind: 'network' } } }), 'failed');
    assert.equal(popupView({ token: 't', syncedAt: 1, articles: [] }), 'empty');
    assert.equal(popupView({ token: 't', syncedAt: 1, articles: [{}] }), 'content');
  });

  it('treats lists older than two minutes as stale', () => {
    assert.ok(isStale(null, 1000));
    assert.equal(isStale(1000, 1000 + 60 * 1000), false);
    assert.ok(isStale(1000, 1000 + 3 * 60 * 1000));
  });
});
