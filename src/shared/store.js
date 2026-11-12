/**
 * Typed access to extension storage, shared by the background and the popup.
 *
 * local   - survives restarts: token, settings, the slim article cache, click log
 * session - cleared when the browser quits: the running job and sync status
 *
 * The background writes everything except settings, which the popup saves
 * directly. Both sides react to storage.onChanged instead of passing state in
 * messages.
 */

import { appendCapped, normalizeSettings } from './core.js';

export const LOCAL = Object.freeze({
  token: 'accessToken',
  userId: 'userId',
  settings: 'userSettings',
  articles: 'articles',
  syncedAt: 'syncedAt',
  authError: 'authError',
  clickLog: 'clickLog'
});

export const SESSION = Object.freeze({
  job: 'job',
  sync: 'syncStatus'
});

// Keys written by v2, removed on update
export const LEGACY_KEYS = ['cachedArticles', 'cacheTimestamp', 'cachedBadgeCount'];

export const IDLE_SYNC = Object.freeze({ running: false, lastError: null, rateLimitedUntil: 0 });

/**
 * @param {Object} storage - `browser.storage`
 */
export function createStore(storage) {
  const { local, session } = storage;

  return {
    async getToken() {
      return (await local.get(LOCAL.token))[LOCAL.token];
    },

    async getUserId() {
      return (await local.get(LOCAL.userId))[LOCAL.userId];
    },

    async setUserId(userId) {
      await local.set({ [LOCAL.userId]: userId });
    },

    async getSettings() {
      return normalizeSettings((await local.get(LOCAL.settings))[LOCAL.settings]);
    },

    async saveSettings(settings) {
      const normalized = normalizeSettings(settings);
      await local.set({ [LOCAL.settings]: normalized });
      return normalized;
    },

    async getArticles() {
      const result = await local.get(LOCAL.articles);
      return Array.isArray(result[LOCAL.articles]) ? result[LOCAL.articles] : [];
    },

    async getSyncedAt() {
      return (await local.get(LOCAL.syncedAt))[LOCAL.syncedAt] || null;
    },

    async setArticles(articles, syncedAt) {
      const values = { [LOCAL.articles]: articles };
      if (syncedAt !== undefined) {
        values[LOCAL.syncedAt] = syncedAt;
      }
      await local.set(values);
    },

    /**
     * Drops opened articles from the cache, so the count is right without a refetch.
     * @param {Array<string>} ids
     */
    async removeArticles(ids) {
      const gone = new Set(ids);
      const articles = await this.getArticles();
      await local.set({ [LOCAL.articles]: articles.filter(article => !gone.has(article.id)) });
    },

    async connect(token, userId) {
      await local.set({ [LOCAL.token]: token, [LOCAL.userId]: userId, [LOCAL.authError]: false });
    },

    /** Forgets the account and its cache; settings and the click log stay. */
    async disconnect() {
      await local.remove([LOCAL.token, LOCAL.userId, LOCAL.articles, LOCAL.syncedAt, LOCAL.authError]);
      await session.remove([SESSION.job, SESSION.sync]);
    },

    async getAuthError() {
      return (await local.get(LOCAL.authError))[LOCAL.authError] === true;
    },

    async setAuthError(value) {
      await local.set({ [LOCAL.authError]: value });
    },

    async getClickLog() {
      const result = await local.get(LOCAL.clickLog);
      return Array.isArray(result[LOCAL.clickLog]) ? result[LOCAL.clickLog] : [];
    },

    async appendClickLog(entries) {
      if (entries.length === 0) {
        return;
      }
      const log = await this.getClickLog();
      await local.set({ [LOCAL.clickLog]: appendCapped(log, entries) });
    },

    async clearClickLog() {
      await local.remove(LOCAL.clickLog);
    },

    async getJob() {
      return (await session.get(SESSION.job))[SESSION.job] || null;
    },

    async setJob(job) {
      await session.set({ [SESSION.job]: job });
    },

    async getSyncStatus() {
      return { ...IDLE_SYNC, ...(await session.get(SESSION.sync))[SESSION.sync] };
    },

    async setSyncStatus(status) {
      await session.set({ [SESSION.sync]: { ...IDLE_SYNC, ...status } });
    },

    /** Removes v2 cache keys and rewrites settings in the current shape. */
    async migrate() {
      await local.remove(LEGACY_KEYS);
      await this.saveSettings(await this.getSettings());
    }
  };
}
