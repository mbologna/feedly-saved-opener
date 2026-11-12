/**
 * Incremental sync of the saved list.
 *
 * Each run fetches only the saved ids (a small payload, one request for up to
 * 1000 articles), then downloads entries for ids not already cached. On failure
 * the cache is kept and the error recorded, so the popup can still show the list.
 */

import { slimEntry } from '../shared/core.js';
import { FeedlyError } from './feedly.js';

/**
 * @param {Object} deps
 * @param {ReturnType<import('./feedly.js').createFeedlyClient>} deps.client
 * @param {ReturnType<import('../shared/store.js').createStore>} deps.store
 * @param {() => number} [deps.now]
 * @param {() => Promise<boolean>} [deps.isBusy] - true while a job is opening
 *   articles: the job edits the cache then, and a sync result read before its
 *   unsave would bring opened articles back
 */
export function createSync({ client, store, now = Date.now, isBusy = async () => false }) {
  let inflight = null;

  async function getUserId() {
    const cached = await store.getUserId();
    if (cached) {
      return cached;
    }
    const { id } = await client.profile();
    await store.setUserId(id);
    return id;
  }

  async function run(force) {
    const status = await store.getSyncStatus();
    if (!force && status.rateLimitedUntil > now()) {
      return { skipped: 'rate-limit' };
    }
    if (!(await store.getToken())) {
      return { skipped: 'not-connected' };
    }
    if (await isBusy()) {
      return { skipped: 'job-running' };
    }

    await store.setSyncStatus({ ...status, running: true });
    try {
      const userId = await getUserId();
      const ids = await client.savedIds(userId);

      const byId = new Map((await store.getArticles()).map(article => [article.id, article]));
      const missing = ids.filter(id => !byId.has(id));
      if (missing.length > 0) {
        for (const entry of await client.entries(missing)) {
          const article = slimEntry(entry);
          if (article) {
            byId.set(article.id, article);
          }
        }
      }

      const articles = ids.map(id => byId.get(id)).filter(Boolean);
      if (await isBusy()) {
        await store.setSyncStatus({});
        return { skipped: 'job-running' };
      }
      await store.setArticles(articles, now());
      await store.setAuthError(false);
      await store.setSyncStatus({});
      return { count: articles.length, fetched: missing.length };
    } catch (error) {
      const kind = error instanceof FeedlyError ? error.kind : 'unknown';
      if (kind === 'auth') {
        await store.setAuthError(true);
      }
      await store.setSyncStatus({
        lastError: { kind, message: error.message, at: now() },
        rateLimitedUntil: kind === 'rate-limit' && error.retryAfterMs ? now() + error.retryAfterMs : 0
      });
      throw error;
    }
  }

  return {
    /**
     * Runs a sync, or joins the one already running.
     * @param {{force?: boolean}} [options] - force ignores a recorded rate limit
     * @returns {Promise<{count?: number, fetched?: number, skipped?: string}>}
     */
    sync({ force = false } = {}) {
      inflight ??= run(force).finally(() => {
        inflight = null;
      });
      return inflight;
    }
  };
}
