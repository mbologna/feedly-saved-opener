// Feedly API Configuration
const FEEDLY_CONFIG = {
  apiBase: 'https://cloud.feedly.com/v3'
};

const STORAGE_KEYS = {
  accessToken: 'accessToken',
  userId: 'userId'
};

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

  static async makeRequest(url, options = {}) {
    const token = await this.getStoredToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (response.status === 401) throw new Error('401 Unauthorized');
    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  static async getStarredArticles() {
    let userId = (await browser.storage.local.get(STORAGE_KEYS.userId))[STORAGE_KEYS.userId];

    if (!userId) {
      const profile = await this.makeRequest(`${FEEDLY_CONFIG.apiBase}/profile`);
      userId = profile.id;
      await browser.storage.local.set({ [STORAGE_KEYS.userId]: userId });
    }

    const streamId = encodeURIComponent(`user/${userId}/tag/global.saved`);
    const url = `${FEEDLY_CONFIG.apiBase}/streams/contents?streamId=${streamId}&count=1000`;
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
        let openedCount = 0;
        const list = message.articles || [];

        for (const article of list) {
          const url = article.canonicalUrl || (article.alternate && article.alternate[0]?.href);
          if (url) {
            // Open tab
            await browser.tabs.create({ url, active: false });
            openedCount++;

            // Unstar (Fire and forget, but catch errors so loop continues)
            try {
              await FeedlyAPI.unstarArticle(article.id);
            } catch (e) {
              console.warn('Failed to unstar:', article.id, e);
            }

            // Slight delay to prevent browser locking up
            await new Promise(r => setTimeout(r, 100));
          }
        }

        // Update badge with remaining count estimation
        const currentTotal = await FeedlyAPI.getStarredArticles();
        updateBadge(currentTotal.length);

        return { opened: openedCount };
    }
  } catch (error) {
    return { error: error.message };
  }
});

function updateBadge(count) {
  if (count > 0) {
    browser.browserAction.setBadgeText({ text: count.toString() });
    browser.browserAction.setBadgeBackgroundColor({ color: '#667eea' });
  } else {
    browser.browserAction.setBadgeText({ text: '' });
  }
}
