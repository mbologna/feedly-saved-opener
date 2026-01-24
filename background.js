// Feedly API Configuration
const FEEDLY_CONFIG = {
  apiBase: 'https://cloud.feedly.com/v3'
};

const STORAGE_KEYS = {
  accessToken: 'accessToken',
  userId: 'userId',
  batchSize: 'userSettings' // reading batch size for context menu
};

// Utils
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class FeedlyAPI {
  static async getStoredToken() {
    const res = await browser.storage.local.get(STORAGE_KEYS.accessToken);
    return res[STORAGE_KEYS.accessToken];
  }

  static async saveToken(token) {
    await browser.storage.local.set({ [STORAGE_KEYS.accessToken]: token });
  }

  static async clearToken() {
    await browser.storage.local.remove([STORAGE_KEYS.accessToken, STORAGE_KEYS.userId]);
  }

  static async makeRequest(url, options = {}, retries = 3, backoff = 1000) {
    const token = await this.getStoredToken();
    if (!token) throw new Error('Not authenticated');

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (response.status === 401) throw new Error('401 Unauthorized');

      // Handle Rate Limits (429) or Server Errors (5xx)
      if (response.status === 429 || response.status >= 500) {
        if (retries > 0) {
          console.warn(`Request failed (${response.status}), retrying in ${backoff}ms...`);
          await wait(backoff);
          return this.makeRequest(url, options, retries - 1, backoff * 2);
        }
      }

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const text = await response.text();
      return text ? JSON.parse(text) : null;

    } catch (error) {
      if (retries > 0 && error.message === 'Failed to fetch') {
        // Network blip retry
        await wait(backoff);
        return this.makeRequest(url, options, retries - 1, backoff * 2);
      }
      throw error;
    }
  }

  static async getStarredArticles() {
    let userId = (await browser.storage.local.get(STORAGE_KEYS.userId))[STORAGE_KEYS.userId];

    if (!userId) {
      const profile = await this.makeRequest(`${FEEDLY_CONFIG.apiBase}/profile`);
      userId = profile.id;
      await browser.storage.local.set({ [STORAGE_KEYS.userId]: userId });
    }

    const streamId = encodeURIComponent(`user/${userId}/tag/global.saved`);
    // Cache busting
    const url = `${FEEDLY_CONFIG.apiBase}/streams/contents?streamId=${streamId}&count=1000&ts=${Date.now()}`;
    const data = await this.makeRequest(url);
    return data.items || [];
  }

  static async unstarArticle(entryId) {
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

// Context Menu Setup
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "open-next-batch",
    title: "⚡ Open Next Batch",
    contexts: ["action"]
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "open-next-batch") {
    // Determine batch size from settings or default
    const settings = await browser.storage.local.get(STORAGE_KEYS.batchSize);
    const batchSize = settings[STORAGE_KEYS.batchSize]?.batchSize || 30;

    // Fetch and open
    const articles = await FeedlyAPI.getStarredArticles();
    if (articles.length > 0) {
      const toOpen = articles.slice(0, batchSize);
      processBatch(toOpen);
    }
  }
});

// Logic extracted for reuse (Context menu + Popup)
async function processBatch(list) {
  let openedCount = 0;
  for (const article of list) {
    const url = article.canonicalUrl || (article.alternate && article.alternate[0]?.href);
    if (url) {
      await browser.tabs.create({ url, active: false });
      openedCount++;

      // Fire and forget unstar, but with error logging
      FeedlyAPI.unstarArticle(article.id).catch(e => console.error("Unstar failed", e));

      // Small delay to be gentle on the browser
      await wait(150);
    }
  }

  // Update badge
  const currentTotal = await FeedlyAPI.getStarredArticles();
  updateBadge(currentTotal.length);

  return openedCount;
}

browser.runtime.onMessage.addListener(async (message) => {
  try {
    switch (message.action) {
      case 'checkAuth':
        const token = await FeedlyAPI.getStoredToken();
        return { authenticated: !!token };

      case 'saveToken':
        await FeedlyAPI.saveToken(message.token);
        return { success: true };

      case 'logout':
        await FeedlyAPI.clearToken();
        updateBadge(0);
        return { success: true };

      case 'getArticles':
        const articles = await FeedlyAPI.getStarredArticles();
        updateBadge(articles.length);
        return { articles };

      case 'openBatch':
        const opened = await processBatch(message.articles || []);
        return { opened };
    }
  } catch (error) {
    return { error: error.message };
  }
});

function updateBadge(count) {
  if (count > 0) {
    browser.action.setBadgeText({ text: count.toString() });
    browser.action.setBadgeBackgroundColor({ color: '#667eea' });
  } else {
    browser.action.setBadgeText({ text: '' });
  }
}
