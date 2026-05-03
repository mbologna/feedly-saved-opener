/**
 * Feedly Saved Opener - Background Service Worker
 * Handles API communication, badge updates, and article processing
 */

// =============================================================================
// Configuration
// =============================================================================

const FEEDLY_CONFIG = {
  apiBase: 'https://cloud.feedly.com/v3'
};

const STORAGE_KEYS = {
  accessToken: 'accessToken',
  userId: 'userId',
  userSettings: 'userSettings',
  cachedBadgeCount: 'cachedBadgeCount',
  cachedArticles: 'cachedArticles',
  cacheTimestamp: 'cacheTimestamp',
  clickLog: 'clickLog'
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DELAYS = {
  tabCreation: 150,      // Delay between opening tabs (ms)
  retryBackoff: 1000,    // Initial retry delay (ms)
  maxRetries: 3,         // Maximum retry attempts
  fetchTimeout: 10000    // API request timeout (ms)
};

const ALARM_NAME = 'badge-update';
const UPDATE_INTERVAL_MINUTES = 15;

// =============================================================================
// Utilities
// =============================================================================

/**
 * Delays execution for a specified duration
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Validates that a URL is safe to open (http/https only)
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
function isValidUrl(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

/**
 * Extracts the best available URL from an article object
 * @param {Object} article - Feedly article object
 * @returns {string|undefined}
 */
function getArticleUrl(article) {
  return article?.canonicalUrl || article?.alternate?.[0]?.href;
}

// =============================================================================
// Feedly API Client
// =============================================================================

/**
 * Client for interacting with the Feedly API
 * Handles authentication, requests with retry logic, and article operations
 */
class FeedlyAPI {
  /**
   * Retrieves the stored authentication token
   * @returns {Promise<string|undefined>}
   */
  static async getStoredToken() {
    const result = await browser.storage.local.get(STORAGE_KEYS.accessToken);
    return result[STORAGE_KEYS.accessToken];
  }

  /**
   * Saves an authentication token to storage
   * @param {string} token - The Feedly API token
   * @throws {Error} If token is invalid
   */
  static async saveToken(token) {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('Invalid token: must be a non-empty string');
    }
    await browser.storage.local.set({ [STORAGE_KEYS.accessToken]: token.trim() });
  }

  /**
   * Clears stored authentication credentials
   */
  static async clearToken() {
    await browser.storage.local.remove([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.userId
    ]);
  }

  /**
   * Makes an authenticated API request with retry logic
   * @param {string} url - The API endpoint URL
   * @param {Object} options - Fetch options
   * @param {number} retries - Remaining retry attempts
   * @param {number} backoff - Current backoff delay in ms
   * @returns {Promise<Object|null>} Parsed JSON response or null
   * @throws {Error} On authentication failure or max retries exceeded
   */
  static async makeRequest(url, options = {}, retries = DELAYS.maxRetries, backoff = DELAYS.retryBackoff) {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELAYS.fetchTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (response.status === 401) {
        throw new Error('401 Unauthorized');
      }

      if (response.status === 429 || response.status >= 500) {
        if (retries > 0) {
          console.warn(`Request failed (${response.status}), retrying in ${backoff}ms... (${retries} retries left)`);
          await wait(backoff);
          return this.makeRequest(url, options, retries - 1, backoff * 2);
        }
        throw new Error(`API Error: ${response.status} - Max retries exceeded`);
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : null;

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout', { cause: error });
      }
      if (retries > 0 && (error.message === 'Failed to fetch' || error.name === 'NetworkError')) {
        console.warn(`Network error, retrying in ${backoff}ms...`);
        await wait(backoff);
        return this.makeRequest(url, options, retries - 1, backoff * 2);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetches the user's Feedly profile
   * @returns {Promise<Object>} User profile data
   */
  static async getProfile() {
    return this.makeRequest(`${FEEDLY_CONFIG.apiBase}/profile`);
  }

  /**
   * Gets the user ID, fetching from API if not cached
   * @returns {Promise<string>} User ID
   */
  static async getUserId() {
    const result = await browser.storage.local.get(STORAGE_KEYS.userId);
    let userId = result[STORAGE_KEYS.userId];

    if (!userId) {
      const profile = await this.getProfile();
      userId = profile.id;
      await browser.storage.local.set({ [STORAGE_KEYS.userId]: userId });
    }

    return userId;
  }

  /**
   * Fetches all saved/starred articles with optional caching
   * @param {boolean} forceRefresh - Skip cache and fetch fresh data
   * @returns {Promise<{articles: Array, fromCache: boolean, lastSync: number}>}
   */
  static async getStarredArticles(forceRefresh = false) {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await browser.storage.local.get([
        STORAGE_KEYS.cachedArticles,
        STORAGE_KEYS.cacheTimestamp
      ]);

      const cacheAge = Date.now() - (cached[STORAGE_KEYS.cacheTimestamp] || 0);
      if (cached[STORAGE_KEYS.cachedArticles] && cacheAge < CACHE_TTL_MS) {
        return {
          articles: cached[STORAGE_KEYS.cachedArticles],
          fromCache: true,
          lastSync: cached[STORAGE_KEYS.cacheTimestamp]
        };
      }
    }

    try {
      const userId = await this.getUserId();
      const streamId = encodeURIComponent(`user/${userId}/tag/global.saved`);

      const url = `${FEEDLY_CONFIG.apiBase}/streams/contents?streamId=${streamId}&count=1000&unreadOnly=false&ts=${Date.now()}`;

      const data = await this.makeRequest(url);
      const articles = data?.items || [];
      const lastSync = Date.now();

      await browser.storage.local.set({
        [STORAGE_KEYS.cachedArticles]: articles,
        [STORAGE_KEYS.cacheTimestamp]: lastSync
      });

      return { articles, fromCache: false, lastSync };

    } catch (error) {
      // On network error, return cached data if available (offline mode)
      if (error.message === 'Failed to fetch' || error.name === 'NetworkError') {
        const cached = await browser.storage.local.get([
          STORAGE_KEYS.cachedArticles,
          STORAGE_KEYS.cacheTimestamp
        ]);

        if (cached[STORAGE_KEYS.cachedArticles]) {
          console.warn('Network error, returning cached data');
          return {
            articles: cached[STORAGE_KEYS.cachedArticles],
            fromCache: true,
            lastSync: cached[STORAGE_KEYS.cacheTimestamp]
          };
        }
      }
      throw error;
    }
  }

  /**
   * Marks multiple articles as unsaved in a single API call
   * @param {Array<string>} entryIds - Array of article entry IDs
   */
  static async unstarArticles(entryIds) {
    const ids = entryIds.filter(Boolean);
    if (ids.length === 0) {
      return;
    }

    await this.makeRequest(`${FEEDLY_CONFIG.apiBase}/markers`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'markAsUnsaved',
        type: 'entries',
        entryIds: ids
      })
    });
  }
}

/**
 * Classifies an error into a category for appropriate handling
 * @param {Error} error - The error to classify
 * @returns {string} Error category
 */
function classifyError(error) {
  const msg = error.message || '';
  if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('authenticated')) {
    return 'AUTH_EXPIRED';
  }
  if (msg.includes('Failed to fetch') || error.name === 'NetworkError' || msg.includes('Request timeout')) {
    return 'NETWORK';
  }
  if (msg.includes('429')) {
    return 'RATE_LIMITED';
  }
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
    return 'SERVER_ERROR';
  }
  return 'UNKNOWN';
}

// =============================================================================
// Badge Management
// =============================================================================

const BADGE_MAX_DISPLAY = 999;
const BADGE_COLORS = {
  normal: '#667eea',
  error: '#dc3545'
};

/**
 * Updates the extension badge with the article count
 * @param {number} count - Number of saved articles
 */
async function updateBadge(count) {
  if (!count || count <= 0) {
    browser.action.setBadgeText({ text: '' });
    await browser.storage.local.remove(STORAGE_KEYS.cachedBadgeCount);
    return;
  }

  const displayCount = count > BADGE_MAX_DISPLAY ? `${BADGE_MAX_DISPLAY}+` : count.toString();
  browser.action.setBadgeText({ text: displayCount });
  browser.action.setBadgeBackgroundColor({ color: BADGE_COLORS.normal });

  await browser.storage.local.set({ [STORAGE_KEYS.cachedBadgeCount]: count });
}

/**
 * Sets the badge to show an error state
 */
function setBadgeError() {
  browser.action.setBadgeText({ text: '!' });
  browser.action.setBadgeBackgroundColor({ color: BADGE_COLORS.error });
}

// =============================================================================
// Article Processing
// =============================================================================

/**
 * Processes a batch of articles by opening them in new tabs and unsaving them
 * @param {Array<Object>} articles - Array of article objects to process
 * @returns {Promise<{opened: number, unstarFailed: number}>} Results with counts
 */
async function processBatch(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return { opened: 0, unstarFailed: 0 };
  }

  let openedCount = 0;
  const openedIds = [];

  for (const article of articles) {
    try {
      const url = getArticleUrl(article);

      if (!isValidUrl(url)) {
        console.warn('Invalid URL for article:', article.id);
        continue;
      }

      await browser.tabs.create({ url, active: false });
      openedCount++;
      openedIds.push(article.id);

      // Fire-and-forget: append to persistent click log
      browser.storage.local.get(STORAGE_KEYS.clickLog).then(result => {
        const log = result[STORAGE_KEYS.clickLog] || [];
        log.push({
          url,
          feedTitle: article.origin?.title || null,
          feedId: article.origin?.streamId || null,
          timestamp: Date.now()
        });
        return browser.storage.local.set({ [STORAGE_KEYS.clickLog]: log });
      }).catch(err => console.error('Failed to log click:', err));

      await wait(DELAYS.tabCreation);
    } catch (error) {
      console.error('Failed to open article:', article.id, error);
    }
  }

  // Batch unstar all opened articles in a single API call
  let unstarFailed = 0;
  if (openedIds.length > 0) {
    try {
      await FeedlyAPI.unstarArticles(openedIds);
    } catch (error) {
      console.error('Failed to unsave articles:', error);
      unstarFailed = openedIds.length;
    }
  }

  // Update badge with remaining count
  try {
    const result = await FeedlyAPI.getStarredArticles(true);
    updateBadge(result.articles.length);
  } catch (error) {
    console.error('Failed to update badge:', error);
  }

  return { opened: openedCount, unstarFailed };
}

// =============================================================================
// Context Menu
// =============================================================================

const CONTEXT_MENU_ID = 'open-next-batch';
const DEFAULT_BATCH_SIZE = 30;

/**
 * Sets up the context menu when extension is installed
 */
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '⚡ Open Next Batch',
    contexts: ['action']
  });
});

/**
 * Handles context menu clicks
 */
browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }

  try {
    const settings = await browser.storage.local.get(STORAGE_KEYS.userSettings);
    const batchSize = settings[STORAGE_KEYS.userSettings]?.batchSize || DEFAULT_BATCH_SIZE;

    const result = await FeedlyAPI.getStarredArticles(true);

    if (result.articles.length === 0) {
      console.log('No saved articles to open');
      return;
    }

    const batch = result.articles.slice(0, batchSize);
    await processBatch(batch);

  } catch (error) {
    console.error('Context menu error:', error);
    setBadgeError();
  }
});

// =============================================================================
// Message Handler (IPC with popup)
// =============================================================================

/**
 * Handles messages from the popup
 * @param {Object} message - Message object with action and optional data
 * @returns {Promise<Object>} Response object
 */
browser.runtime.onMessage.addListener(async (message) => {
  try {
    switch (message.action) {
    case 'checkAuth': {
      const token = await FeedlyAPI.getStoredToken();
      return { authenticated: !!token };
    }

    case 'saveToken': {
      if (!message.token) {
        throw new Error('Token is required');
      }
      await FeedlyAPI.saveToken(message.token);

      await FeedlyAPI.getProfile();
      startPeriodicUpdate();

      return { success: true };
    }

    case 'logout': {
      await FeedlyAPI.clearToken();
      stopPeriodicUpdate();
      updateBadge(0);
      return { success: true };
    }

    case 'getArticles': {
      const result = await FeedlyAPI.getStarredArticles(message.forceRefresh);
      updateBadge(result.articles.length);
      return {
        articles: result.articles,
        lastSync: result.lastSync,
        fromCache: result.fromCache
      };
    }

    case 'openBatch': {
      if (!Array.isArray(message.articles)) {
        throw new Error('Invalid articles array');
      }
      const result = await processBatch(message.articles);
      return { opened: result.opened, unstarFailed: result.unstarFailed };
    }

    case 'getClickLog': {
      const result = await browser.storage.local.get(STORAGE_KEYS.clickLog);
      return { log: result[STORAGE_KEYS.clickLog] || [] };
    }

    case 'clearClickLog': {
      await browser.storage.local.remove(STORAGE_KEYS.clickLog);
      return { success: true };
    }

    default:
      return { error: `Unknown action: ${message.action}` };
    }
  } catch (error) {
    console.error('Message handler error:', error);
    const errorType = classifyError(error);

    if (errorType === 'AUTH_EXPIRED') {
      setBadgeError();
    }

    return { error: error.message, errorType };
  }
});

// =============================================================================
// Periodic Badge Updates (using Alarms API for service worker reliability)
// =============================================================================

/**
 * Updates the badge with the current article count
 * Called periodically and on demand
 */
async function updateBadgeCount() {
  try {
    const token = await FeedlyAPI.getStoredToken();
    if (!token) {
      updateBadge(0);
      return;
    }

    const result = await FeedlyAPI.getStarredArticles(true); // Force refresh for periodic updates
    updateBadge(result.articles.length);
  } catch (error) {
    console.error('Badge update error:', error);
    if (error.message.includes('401')) {
      setBadgeError();
    }
  }
}

/**
 * Starts periodic badge updates using the alarms API
 * More reliable than setInterval for service workers
 */
async function startPeriodicUpdate() {
  await browser.alarms.clear(ALARM_NAME);

  const cached = await browser.storage.local.get(STORAGE_KEYS.cachedBadgeCount);
  if (cached[STORAGE_KEYS.cachedBadgeCount]) {
    updateBadge(cached[STORAGE_KEYS.cachedBadgeCount]);
  }

  await browser.alarms.create(ALARM_NAME, {
    delayInMinutes: UPDATE_INTERVAL_MINUTES,
    periodInMinutes: UPDATE_INTERVAL_MINUTES
  });

  updateBadgeCount();
}

/**
 * Stops periodic badge updates
 */
async function stopPeriodicUpdate() {
  await browser.alarms.clear(ALARM_NAME);
}

/**
 * Handles alarm events for badge updates
 */
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    updateBadgeCount();
  }
});

// Force refresh badge on browser startup
browser.runtime.onStartup.addListener(() => {
  updateBadgeCount();
});

// Initialize on install/update
startPeriodicUpdate();
