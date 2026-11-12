/**
 * Pure logic shared by the background and the popup. No browser APIs here, so
 * everything in this file runs unchanged under `node --test`.
 */

export const SORT_ORDERS = ['newest', 'oldest'];
export const BATCH_SIZE = Object.freeze({ min: 1, max: 100, default: 30 });
export const CLICK_LOG_MAX_ENTRIES = 500;
export const BADGE_MAX = 999;

export const DEFAULT_SETTINGS = Object.freeze({
  batchSize: BATCH_SIZE.default,
  sortOrder: 'newest',
  priorityDomains: [],
  groupTabs: false
});

// =============================================================================
// Articles
// =============================================================================

/**
 * Picks the link to open for a Feedly entry: the canonical URL when Feedly has
 * one, otherwise the first alternate link.
 * @param {Object} entry - Feedly entry
 * @returns {string|undefined}
 */
export function getEntryUrl(entry) {
  return entry?.canonicalUrl || entry?.canonical?.[0]?.href || entry?.alternate?.[0]?.href;
}

/**
 * Only http(s) links are opened; anything else (javascript:, data:, feed-internal
 * ids) is skipped.
 * @param {string} url
 * @returns {boolean}
 */
export function isOpenableUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Reduces a full Feedly entry (which carries the article HTML) to the few fields
 * the extension uses, so the cache and every message stay small.
 * @param {Object} entry - Feedly entry
 * @returns {{id: string, title: string, url: string|null, source: string|null, feedId: string|null}|null}
 */
export function slimEntry(entry) {
  if (!entry?.id) {
    return null;
  }
  return {
    id: entry.id,
    title: entry.title?.trim() || 'Untitled',
    url: getEntryUrl(entry) || null,
    source: entry.origin?.title || null,
    feedId: entry.origin?.streamId || null
  };
}

/**
 * Tells whether an article's link matches a priority entry. A bare domain
 * (`ilpost.it`) matches that host and its subdomains; an entry with a path
 * (`youtube.com/@channel`) matches as a substring of the link.
 * @param {string|null} url
 * @param {string} domain - normalized entry from parsePriorityDomains
 * @returns {boolean}
 */
export function matchesDomain(url, domain) {
  if (!url) {
    return false;
  }
  if (domain.includes('/')) {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').includes(domain);
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/**
 * Moves articles from priority domains to the front, keeping the relative order
 * inside both groups.
 * @param {Array<Object>} articles - slim articles
 * @param {Array<string>} domains - normalized priority entries
 * @returns {Array<Object>}
 */
export function prioritize(articles, domains = []) {
  if (domains.length === 0) {
    return articles;
  }
  const first = [];
  const rest = [];
  for (const article of articles) {
    (domains.some(domain => matchesDomain(article.url, domain)) ? first : rest).push(article);
  }
  return [...first, ...rest];
}

/**
 * The cache keeps Feedly's newest-first order; the user's sort order and
 * priority domains are applied on read, so changing them needs no network call.
 * @param {Array<Object>} articles - slim articles, newest first
 * @param {Object} settings - normalized settings
 * @returns {Array<Object>}
 */
export function orderArticles(articles, settings) {
  const sorted = settings.sortOrder === 'oldest' ? [...articles].reverse() : articles;
  return prioritize(sorted, settings.priorityDomains);
}

// =============================================================================
// Settings
// =============================================================================

/**
 * @param {number|string} value
 * @returns {number} integer in [BATCH_SIZE.min, BATCH_SIZE.max]
 */
export function clampBatchSize(value) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) {
    return BATCH_SIZE.default;
  }
  return Math.min(BATCH_SIZE.max, Math.max(BATCH_SIZE.min, num));
}

/**
 * Normalizes one priority entry: lowercase, no scheme, no leading `www.`, no
 * trailing slash. `https://www.ilpost.it/` becomes `ilpost.it`.
 * @param {string} line
 * @returns {string}
 */
export function normalizeDomain(line) {
  return String(line)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

/**
 * Parses the priority-domains textarea: one entry per line, normalized, deduplicated.
 * @param {string} text
 * @returns {Array<string>}
 */
export function parsePriorityDomains(text) {
  const domains = String(text ?? '').split('\n').map(normalizeDomain).filter(Boolean);
  return [...new Set(domains)];
}

/**
 * Fills in defaults and drops invalid values, so stored settings from any older
 * version are safe to use.
 * @param {Object} [raw]
 * @returns {{batchSize: number, sortOrder: string, priorityDomains: Array<string>, groupTabs: boolean}}
 */
export function normalizeSettings(raw = {}) {
  const settings = raw && typeof raw === 'object' ? raw : {};
  return {
    batchSize: settings.batchSize === undefined ? DEFAULT_SETTINGS.batchSize : clampBatchSize(settings.batchSize),
    sortOrder: SORT_ORDERS.includes(settings.sortOrder) ? settings.sortOrder : DEFAULT_SETTINGS.sortOrder,
    priorityDomains: Array.isArray(settings.priorityDomains)
      ? parsePriorityDomains(settings.priorityDomains.join('\n'))
      : [],
    groupTabs: settings.groupTabs === true
  };
}

// =============================================================================
// Click log and stats
// =============================================================================

/**
 * Appends entries and keeps only the newest `max`.
 * @param {Array<Object>} log
 * @param {Array<Object>} entries
 * @param {number} [max]
 * @returns {Array<Object>}
 */
export function appendCapped(log, entries, max = CLICK_LOG_MAX_ENTRIES) {
  const combined = [...(Array.isArray(log) ? log : []), ...entries];
  return combined.length > max ? combined.slice(combined.length - max) : combined;
}

/**
 * Click-log entry for an opened article. The shape is the one exported as JSON,
 * so keep it stable.
 * @param {Object} article - slim article
 * @param {number} timestamp
 * @returns {{url: string, feedTitle: string|null, feedId: string|null, timestamp: number}}
 */
export function clickLogEntry(article, timestamp) {
  return {
    url: article.url,
    feedTitle: article.source || null,
    feedId: article.feedId || null,
    timestamp
  };
}

/**
 * @param {Object} entry - click-log entry
 * @returns {string|null} feed title, or the link's host when there is none
 */
function statsKey(entry) {
  if (entry.feedTitle) {
    return entry.feedTitle;
  }
  if (!entry.url) {
    return null;
  }
  try {
    return new URL(entry.url).hostname.replace(/^www\./, '');
  } catch {
    return entry.url;
  }
}

/**
 * Summarizes the click log for the stats panel.
 * @param {Array<Object>} log
 * @param {number} [limit] - number of top sources
 * @returns {{total: number, first: number|null, last: number|null, top: Array<[string, number]>}}
 */
export function aggregateStats(log, limit = 10) {
  const entries = Array.isArray(log) ? log : [];
  const counts = new Map();
  let first = null;
  let last = null;
  for (const entry of entries) {
    if (entry.timestamp) {
      first = first === null ? entry.timestamp : Math.min(first, entry.timestamp);
      last = last === null ? entry.timestamp : Math.max(last, entry.timestamp);
    }
    const key = statsKey(entry);
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return { total: entries.length, first, last, top };
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * @param {string} word
 * @param {number} count
 * @param {string} [plural]
 * @returns {string} e.g. "1 article", "3 articles"
 */
export function countLabel(count, word, plural = `${word}s`) {
  return `${count} ${count === 1 ? word : plural}`;
}

/**
 * @param {number} total
 * @param {number} size
 * @returns {number}
 */
export function batchCount(total, size) {
  return total > 0 ? Math.ceil(total / size) : 0;
}

/**
 * @param {number|null} timestamp - ms
 * @param {number} [now]
 * @returns {string} "just now", "5 minutes ago", "3 hours ago", or a date
 */
export function formatRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp) {
    return '';
  }
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${countLabel(minutes, 'minute')} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${countLabel(hours, 'hour')} ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

/**
 * @param {number} count
 * @returns {string} badge text: empty for zero, capped at "999+"
 */
export function badgeText(count) {
  if (!count || count <= 0) {
    return '';
  }
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
}

/**
 * @param {Date} [date]
 * @returns {string} tab group title, e.g. "Feedly · 12 Nov"
 */
export function groupTitle(date = new Date()) {
  return `Feedly · ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/**
 * @template T
 * @param {Array<T>} items
 * @param {number} size
 * @returns {Array<Array<T>>}
 */
export function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// =============================================================================
// Popup view model
// =============================================================================

export const FRESH_MS = 2 * 60 * 1000;

/**
 * Decides which popup view to show from stored state.
 * @param {{token?: string, authError?: boolean, syncedAt?: number, articles?: Array, syncStatus?: Object}} state
 * @returns {'notAuth'|'expired'|'loading'|'failed'|'empty'|'content'}
 */
export function popupView(state) {
  if (!state.token) {
    return 'notAuth';
  }
  if (state.authError) {
    return 'expired';
  }
  if (!state.syncedAt) {
    // No list yet: keep the skeleton while the first sync runs, not after it fails
    return state.syncStatus?.lastError && !state.syncStatus.running ? 'failed' : 'loading';
  }
  return state.articles?.length ? 'content' : 'empty';
}

/**
 * @param {number|null} syncedAt
 * @param {number} [now]
 * @returns {boolean} whether the cached list is old enough to refresh
 */
export function isStale(syncedAt, now = Date.now()) {
  return !syncedAt || now - syncedAt > FRESH_MS;
}
