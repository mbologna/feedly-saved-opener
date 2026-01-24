// Feedly API Configuration
const FEEDLY_CONFIG = {
  apiBase: 'https://cloud.feedly.com/v3'
};

const STORAGE_KEYS = {
  accessToken: 'accessToken',
  userId: 'userId',
  userSettings: 'userSettings'
};

const DELAYS = {
  tabCreation: 150,      // Delay between opening tabs
  retryBackoff: 1000,    // Initial retry delay
  maxRetries: 3          // Maximum retry attempts
};

// Utilities
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Feedly API Client
 */
class FeedlyAPI {
  static async getStoredToken() {
    const result = await browser.storage.local.get(STORAGE_KEYS.accessToken);
    return result[STORAGE_KEYS.accessToken];
  }

  static async saveToken(token) {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token');
    }
    await browser.storage.local.set({ [STORAGE_KEYS.accessToken]: token });
  }

  static async clearToken() {
    await browser.storage.local.remove([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.userId
    ]);
  }

  static async makeRequest(url, options = {}, retries = DELAYS.maxRetries, backoff = DELAYS.retryBackoff) {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      // Handle authentication errors
      if (response.status === 401) {
        throw new Error('401 Unauthorized');
      }

      // Handle rate limits and server errors with exponential backoff
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
      // Retry on network errors
      if (retries > 0 && (error.message === 'Failed to fetch' || error.name === 'NetworkError')) {
        console.warn(`Network error, retrying in ${backoff}ms...`);
        await wait(backoff);
        return this.makeRequest(url, options, retries - 1, backoff * 2);
      }
      throw error;
    }
  }

  static async getProfile() {
    return this.makeRequest(`${FEEDLY_CONFIG.apiBase}/profile`);
  }

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

  static async getStarredArticles() {
    const userId = await this.getUserId();
    const streamId = encodeURIComponent(`user/${userId}/tag/global.saved`);

    // Cache busting with timestamp
    const url = `${FEEDLY_CONFIG.apiBase}/streams/contents?streamId=${streamId}&count=1000&unreadOnly=false&ts=${Date.now()}`;

    const data = await this.makeRequest(url);
    return data.items || [];
  }

  static async unstarArticle(entryId) {
    if (!entryId) {
      console.error('Missing entryId for unstar operation');
      return;
    }

    await this.makeRequest(`${FEEDLY_CONFIG.apiBase}/markers`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'markAsUnsaved',
        type: 'entries',
        entryIds: [entryId]
      })
    });
  }
}

/**
 * Badge Management
 */
function updateBadge(count) {
  if (!count || count <= 0) {
    browser.action.setBadgeText({ text: '' });
    return;
  }

  const displayCount = count > 999 ? '999+' : count.toString();
  browser.action.setBadgeText({ text: displayCount });
  browser.action.setBadgeBackgroundColor({ color: '#667eea' });
}

function setBadgeError() {
  browser.action.setBadgeText({ text: '!' });
  browser.action.setBadgeBackgroundColor({ color: '#dc3545' });
}

/**
 * Process batch of articles
 */
async function processBatch(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return 0;
  }

  let openedCount = 0;
  const errors = [];

  for (const article of articles) {
    try {
      const url = article.canonicalUrl || article.alternate?.[0]?.href;

      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        console.warn('Invalid URL for article:', article.id);
        continue;
      }

      await browser.tabs.create({ url, active: false });
      openedCount++;

      // Fire and forget unstar operation
      FeedlyAPI.unstarArticle(article.id).catch(error => {
        console.error('Failed to unstar article:', article.id, error);
        errors.push({ id: article.id, error: error.message });
      });

      // Small delay to avoid overwhelming the browser
      await wait(DELAYS.tabCreation);

    } catch (error) {
      console.error('Failed to open article:', article.id, error);
      errors.push({ id: article.id, error: error.message });
    }
  }

  // Update badge with remaining count
  try {
    const currentArticles = await FeedlyAPI.getStarredArticles();
    updateBadge(currentArticles.length);
  } catch (error) {
    console.error('Failed to update badge:', error);
  }

  if (errors.length > 0) {
    console.warn(`Processed batch with ${errors.length} errors:`, errors);
  }

  return openedCount;
}

/**
 * Context Menu Setup
 */
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'open-next-batch',
    title: '⚡ Open Next Batch',
    contexts: ['action']
  });
});

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'open-next-batch') {
    try {
      // Get batch size from settings
      const settings = await browser.storage.local.get(STORAGE_KEYS.userSettings);
      const batchSize = settings[STORAGE_KEYS.userSettings]?.batchSize || 30;

      // Fetch and open articles
      const articles = await FeedlyAPI.getStarredArticles();

      if (articles.length === 0) {
        console.log('No saved articles to open');
        return;
      }

      const batch = articles.slice(0, batchSize);
      await processBatch(batch);

    } catch (error) {
      console.error('Context menu error:', error);
      setBadgeError();
    }
  }
});

/**
 * Message Handler
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

      // Verify token works by fetching profile
      await FeedlyAPI.getProfile();

      // Start periodic updates
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
      const articles = await FeedlyAPI.getStarredArticles();
      updateBadge(articles.length);
      return { articles };
    }

    case 'openBatch': {
      if (!Array.isArray(message.articles)) {
        throw new Error('Invalid articles array');
      }
      const opened = await processBatch(message.articles);
      return { opened };
    }

    default:
      return { error: 'Unknown action' };
    }
  } catch (error) {
    console.error('Message handler error:', error);

    // Set error badge for auth issues
    if (error.message.includes('401') || error.message.includes('authenticated')) {
      setBadgeError();
    }

    return { error: error.message };
  }
});

/**
 * Periodic badge update
 */
const UPDATE_INTERVAL = 60 * 60 * 1000; // 60 minutes
let updateTimer = null;

async function updateBadgeCount() {
  try {
    const token = await FeedlyAPI.getStoredToken();
    if (!token) {
      updateBadge(0);
      return;
    }

    const articles = await FeedlyAPI.getStarredArticles();
    updateBadge(articles.length);
  } catch (error) {
    console.error('Badge update error:', error);
    if (error.message.includes('401')) {
      setBadgeError();
    }
  }
}

function startPeriodicUpdate() {
  // Clear existing timer
  if (updateTimer) {
    clearInterval(updateTimer);
  }

  // Initial update
  updateBadgeCount();

  // Set up periodic updates
  updateTimer = setInterval(updateBadgeCount, UPDATE_INTERVAL);
}

function stopPeriodicUpdate() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

// Initialize on startup
startPeriodicUpdate();
