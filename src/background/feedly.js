/**
 * Feedly Cloud API client.
 *
 * Every failure is a FeedlyError with a `kind`, so callers branch on that instead
 * of matching message text. Network errors, timeouts, 5xx and short 429 waits
 * are retried with exponential backoff; 401 never is.
 */

import { chunk } from '../shared/core.js';

export const API_BASE = 'https://cloud.feedly.com/v3';

const IDS_PAGE_SIZE = 1000;     // Feedly may return fewer per page; continuation covers it
const MGET_MAX_IDS = 1000;      // documented limit for /entries/.mget and /markers
const MAX_PAGES = 100;          // safety cap on pagination
const MAX_RETRY_WAIT_MS = 30000; // longer 429 waits are reported, not slept through

/**
 * @typedef {'auth'|'network'|'timeout'|'rate-limit'|'server'|'http'} FeedlyErrorKind
 */

export class FeedlyError extends Error {
  /**
   * @param {string} message
   * @param {{kind: FeedlyErrorKind, status?: number, retryAfterMs?: number|null, cause?: unknown}} details
   */
  constructor(message, { kind, status, retryAfterMs = null, cause } = {}) {
    super(message, { cause });
    this.name = 'FeedlyError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Reads how long to wait after a 429: `Retry-After` (seconds or HTTP date), else
 * Feedly's `X-Ratelimit-Reset` (seconds until the counter resets).
 * @param {Headers} headers
 * @param {number} [now]
 * @returns {number|null} ms
 */
export function parseRetryAfter(headers, now = Date.now()) {
  const retryAfter = headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - now);
    }
  }
  const reset = Number(headers.get('X-Ratelimit-Reset'));
  return Number.isFinite(reset) && reset > 0 ? reset * 1000 : null;
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {Object} options
 * @param {() => Promise<string|undefined>} options.getToken
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 * @param {number} [options.backoffMs] - first retry delay, doubled each time
 */
export function createFeedlyClient({
  getToken,
  fetchImpl = (...args) => fetch(...args),
  sleep = wait,
  timeoutMs = 10000,
  maxRetries = 3,
  backoffMs = 1000
}) {
  /**
   * @param {string} path - below API_BASE
   * @param {{method?: string, body?: unknown, query?: Object}} [options]
   * @returns {Promise<any>} parsed JSON, or null for an empty body
   */
  async function request(path, { method = 'GET', body, query = {} } = {}) {
    const token = await getToken();
    if (!token) {
      throw new FeedlyError('Not connected to Feedly', { kind: 'auth' });
    }

    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    for (let attempt = 0; ; attempt++) {
      const delay = backoffMs * 2 ** attempt;
      let response;
      try {
        response = await fetchImpl(url.href, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        // fetch rejects with TypeError on network failure (Firefox: "NetworkError
        // when attempting to fetch resource", Chromium: "Failed to fetch")
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        if (attempt < maxRetries) {
          await sleep(delay);
          continue;
        }
        throw timedOut
          ? new FeedlyError('Feedly did not answer in time', { kind: 'timeout', cause: error })
          : new FeedlyError('Could not reach Feedly', { kind: 'network', cause: error });
      }

      if (response.ok) {
        const text = await response.text();
        try {
          return text ? JSON.parse(text) : null;
        } catch (error) {
          throw new FeedlyError('Feedly sent an unreadable response', { kind: 'server', status: response.status, cause: error });
        }
      }

      const { status } = response;
      if (status === 401) {
        throw new FeedlyError('Feedly rejected the token', { kind: 'auth', status });
      }
      if (status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers);
        const waitMs = retryAfterMs ?? delay;
        if (attempt < maxRetries && waitMs <= MAX_RETRY_WAIT_MS) {
          await sleep(waitMs);
          continue;
        }
        throw new FeedlyError('Feedly rate limit reached', { kind: 'rate-limit', status, retryAfterMs });
      }
      if (status >= 500) {
        if (attempt < maxRetries) {
          await sleep(delay);
          continue;
        }
        throw new FeedlyError(`Feedly server error (${status})`, { kind: 'server', status });
      }
      throw new FeedlyError(`Feedly request failed (${status})`, { kind: 'http', status });
    }
  }

  return {
    request,

    /** @returns {Promise<{id: string}>} */
    profile() {
      return request('/profile');
    },

    /**
     * Ids of every saved entry, newest first.
     * @param {string} userId
     * @returns {Promise<Array<string>>}
     */
    async savedIds(userId) {
      const streamId = `user/${userId}/tag/global.saved`;
      const ids = [];
      let continuation;
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await request(`/streams/${encodeURIComponent(streamId)}/ids`, {
          query: { count: IDS_PAGE_SIZE, ranked: 'newest', continuation }
        });
        ids.push(...(data?.ids ?? []));
        continuation = data?.continuation;
        if (!continuation) {
          break;
        }
      }
      return [...new Set(ids)];
    },

    /**
     * Full entries for the given ids. Ids Feedly no longer knows are left out.
     * @param {Array<string>} ids
     * @returns {Promise<Array<Object>>}
     */
    async entries(ids) {
      const entries = [];
      for (const part of chunk(ids, MGET_MAX_IDS)) {
        const data = await request('/entries/.mget', { method: 'POST', body: part });
        entries.push(...(Array.isArray(data) ? data : []));
      }
      return entries;
    },

    /**
     * @param {Array<string>} ids
     */
    async unsave(ids) {
      for (const part of chunk(ids, MGET_MAX_IDS)) {
        await request('/markers', {
          method: 'POST',
          body: { action: 'markAsUnsaved', type: 'entries', entryIds: part }
        });
      }
    }
  };
}
