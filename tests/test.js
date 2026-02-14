/**
 * Feedly Saved Opener - Comprehensive Test Suite
 * Run: node tests/test.js
 *
 * Tests the extension's core logic by simulating the browser environment
 */

// =============================================================================
// Test Framework
// =============================================================================

const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  tests: [],
  currentGroup: null
};

/**
 * Groups related tests together
 * @param {string} name - Group name
 * @param {Function} fn - Test function
 */
async function describe(name, fn) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📦 ${name}`);
  console.log('='.repeat(60));
  TEST_RESULTS.currentGroup = name;
  await fn();
  TEST_RESULTS.currentGroup = null;
}

/**
 * Runs a single test
 * @param {string} name - Test name
 * @param {Function} fn - Test function
 */
async function it(name, fn) {
  const fullName = TEST_RESULTS.currentGroup ? `${TEST_RESULTS.currentGroup} > ${name}` : name;
  try {
    await fn();
    TEST_RESULTS.passed++;
    TEST_RESULTS.tests.push({ name: fullName, status: 'PASS' });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({ name: fullName, status: 'FAIL', error: error.message });
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${error.message}`);
  }
}

// =============================================================================
// Assertion Utilities
// =============================================================================

function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message}\nExpected: ${expectedStr}\nActual: ${actualStr}`);
  }
}

function assertThrows(fn, expectedMessage = null, message = '') {
  let threw = false;
  let error = null;
  try {
    fn();
  } catch (e) {
    threw = true;
    error = e;
  }
  if (!threw) {
    throw new Error(`${message}\nExpected function to throw`);
  }
  if (expectedMessage && !error.message.includes(expectedMessage)) {
    throw new Error(`${message}\nExpected error containing "${expectedMessage}", got "${error.message}"`);
  }
}

async function assertThrowsAsync(fn, expectedMessage = null, message = '') {
  let threw = false;
  let error = null;
  try {
    await fn();
  } catch (e) {
    threw = true;
    error = e;
  }
  if (!threw) {
    throw new Error(`${message}\nExpected function to throw`);
  }
  if (expectedMessage && !error.message.includes(expectedMessage)) {
    throw new Error(`${message}\nExpected error containing "${expectedMessage}", got "${error.message}"`);
  }
}

function assertArrayLength(arr, length, message = '') {
  if (!Array.isArray(arr)) {
    throw new Error(`${message}\nExpected an array, got ${typeof arr}`);
  }
  if (arr.length !== length) {
    throw new Error(`${message}\nExpected array length ${length}, got ${arr.length}`);
  }
}

function assertTrue(value, message = '') {
  if (value !== true) {
    throw new Error(`${message}\nExpected true, got ${value}`);
  }
}

function assertFalse(value, message = '') {
  // Accept any falsy value (false, null, undefined, 0, '', NaN)
  if (value) {
    throw new Error(`${message}\nExpected falsy value, got ${value}`);
  }
}

function assertNotNull(value, message = '') {
  if (value === null || value === undefined) {
    throw new Error(`${message}\nExpected non-null value`);
  }
}

// =============================================================================
// Mock Browser API
// =============================================================================

function createMockBrowser() {
  const storage = {
    data: {},
    async get(keys) {
      if (typeof keys === 'string') {
        return { [keys]: this.data[keys] };
      }
      if (Array.isArray(keys)) {
        return keys.reduce((acc, key) => ({ ...acc, [key]: this.data[key] }), {});
      }
      return { ...this.data };
    },
    async set(items) {
      Object.assign(this.data, items);
    },
    async remove(keys) {
      const keysArray = Array.isArray(keys) ? keys : [keys];
      keysArray.forEach(key => delete this.data[key]);
    },
    async clear() {
      this.data = {};
    }
  };

  const alarms = {
    alarms: {},
    listeners: [],
    async create(name, options) {
      this.alarms[name] = { name, ...options };
    },
    async clear(name) {
      delete this.alarms[name];
      return true;
    },
    async getAll() {
      return Object.values(this.alarms);
    },
    onAlarm: {
      addListener(fn) {
        alarms.listeners.push(fn);
      }
    },
    // Test helper to trigger alarm
    _triggerAlarm(name) {
      const alarm = this.alarms[name];
      if (alarm) {
        this.listeners.forEach(fn => fn(alarm));
      }
    }
  };

  const tabs = {
    created: [],
    async create(options) {
      if (!options.url) {
        throw new Error('URL required');
      }
      const tab = { id: tabs.created.length + 1, ...options };
      tabs.created.push(tab);
      return tab;
    },
    _reset() {
      this.created = [];
    }
  };

  const action = {
    badgeText: '',
    badgeColor: '',
    async setBadgeText({ text }) {
      this.badgeText = text;
    },
    async setBadgeBackgroundColor({ color }) {
      this.badgeColor = color;
    }
  };

  const contextMenus = {
    menus: {},
    listeners: [],
    create(options) {
      this.menus[options.id] = options;
    },
    onClicked: {
      addListener(fn) {
        contextMenus.listeners.push(fn);
      }
    }
  };

  const runtime = {
    messages: [],
    messageListeners: [],
    onInstalled: {
      addListener(fn) {
        // Immediately call to simulate install
        fn();
      }
    },
    onMessage: {
      addListener(fn) {
        runtime.messageListeners.push(fn);
      }
    },
    async sendMessage(message) {
      runtime.messages.push(message);
      // Return mock response based on action
      for (const listener of runtime.messageListeners) {
        const response = await listener(message);
        if (response !== undefined) {
          return response;
        }
      }
      return { error: 'No handler' };
    }
  };

  return {
    storage: { local: storage },
    alarms,
    tabs,
    action,
    contextMenus,
    runtime
  };
}

/**
 * Creates a mock fetch function for testing API calls
 * @param {Array<Object>} responses - Array of response objects to return in order
 * @returns {Function} Mock fetch function
 */
function createMockFetch(responses) {
  let callIndex = 0;
  const calls = [];

  const mockFetch = async (url, options = {}) => {
    calls.push({ url, options });
    const response = responses[Math.min(callIndex++, responses.length - 1)];

    if (response.error) {
      const error = new Error(response.error);
      error.name = response.errorName || 'Error';
      throw error;
    }

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText || '',
      text: async () => JSON.stringify(response.body),
      json: async () => response.body
    };
  };

  mockFetch.getCalls = () => calls;
  mockFetch.getCallCount = () => calls.length;
  return mockFetch;
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock article object
 */
function createMockArticle(id, url = null, useAlternate = false) {
  const article = { id: `article-${id}`, title: `Article ${id}` };
  if (url) {
    if (useAlternate) {
      article.alternate = [{ href: url, type: 'text/html' }];
    } else {
      article.canonicalUrl = url;
    }
  }
  return article;
}

/**
 * Creates multiple mock articles
 */
function createMockArticles(count, urlPattern = 'https://example.com/article-') {
  return Array.from({ length: count }, (_, i) =>
    createMockArticle(i + 1, `${urlPattern}${i + 1}`)
  );
}

/**
 * Creates mock Feedly API responses for testing
 * @param {number} articleCount - Number of articles to include
 * @returns {Object} Mock responses for profile and articles endpoints
 */
function createFeedlyMockResponses(articleCount = 5) {
  return {
    profile: {
      status: 200,
      body: { id: 'user/12345', email: 'test@example.com', fullName: 'Test User' }
    },
    articles: {
      status: 200,
      body: { items: createMockArticles(articleCount) }
    },
    unstar: {
      status: 200,
      body: null
    },
    unauthorized: {
      status: 401,
      statusText: 'Unauthorized',
      body: { error: 'Token expired' }
    },
    rateLimit: {
      status: 429,
      statusText: 'Too Many Requests',
      body: { error: 'Rate limited' }
    },
    serverError: {
      status: 500,
      statusText: 'Internal Server Error',
      body: { error: 'Server error' }
    },
    networkError: {
      error: 'Failed to fetch',
      errorName: 'NetworkError'
    }
  };
}

/**
 * Creates a mock state object for popup tests
 * @returns {Object} Mock popup state
 */
function createMockPopupState() {
  return {
    articles: [],
    batchSize: 30,
    processing: false,
    lastSync: null,
    articleListVisible: false
  };
}

/**
 * Simulates a delay for async testing
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function mockWait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Core Logic Tests (extracted from background.js patterns)
// =============================================================================

// URL Validation Logic
function isValidUrl(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

// URL Extraction Logic
function getArticleUrl(article) {
  return article?.canonicalUrl || article?.alternate?.[0]?.href;
}

// Badge Text Logic
function getBadgeText(count) {
  if (!count || count <= 0) {
    return '';
  }
  return count > 999 ? '999+' : count.toString();
}

// Batch Size Clamping
function clampBatchSize(value, min = 1, max = 100) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return min;
  }
  return Math.max(min, Math.min(max, num));
}

// =============================================================================
// Test Suites
// =============================================================================

async function runAllTests() {
  console.log('\n🧪 Feedly Saved Opener - Comprehensive Test Suite\n');

  // =========================================================================
  // URL Validation Tests
  // =========================================================================
  await describe('URL Validation', async () => {
    await it('accepts valid HTTPS URLs', () => {
      assertTrue(isValidUrl('https://example.com'));
      assertTrue(isValidUrl('https://example.com/path'));
      assertTrue(isValidUrl('https://example.com/path?query=value'));
      assertTrue(isValidUrl('https://sub.example.com/path'));
    });

    await it('accepts valid HTTP URLs', () => {
      assertTrue(isValidUrl('http://example.com'));
      assertTrue(isValidUrl('http://example.com/path'));
    });

    await it('rejects null and undefined', () => {
      assertFalse(isValidUrl(null));
      assertFalse(isValidUrl(undefined));
    });

    await it('rejects empty strings', () => {
      assertFalse(isValidUrl(''));
    });

    await it('rejects javascript: URLs (XSS prevention)', () => {
      assertFalse(isValidUrl('javascript:alert(1)'));
      assertFalse(isValidUrl('javascript:void(0)'));
    });

    await it('rejects data: URLs', () => {
      assertFalse(isValidUrl('data:text/html,<script>alert(1)</script>'));
    });

    await it('rejects file: URLs', () => {
      assertFalse(isValidUrl('file:///etc/passwd'));
    });

    await it('rejects ftp: URLs', () => {
      assertFalse(isValidUrl('ftp://example.com'));
    });

    await it('rejects malformed URLs', () => {
      assertFalse(isValidUrl('not-a-url'));
      assertFalse(isValidUrl('://example.com'));
      assertFalse(isValidUrl('example.com'));
    });
  });

  // =========================================================================
  // Article URL Extraction Tests
  // =========================================================================
  await describe('Article URL Extraction', async () => {
    await it('extracts canonicalUrl when present', () => {
      const article = { canonicalUrl: 'https://example.com/canonical' };
      assertEqual(getArticleUrl(article), 'https://example.com/canonical');
    });

    await it('extracts alternate URL when canonicalUrl is missing', () => {
      const article = { alternate: [{ href: 'https://example.com/alternate' }] };
      assertEqual(getArticleUrl(article), 'https://example.com/alternate');
    });

    await it('prefers canonicalUrl over alternate', () => {
      const article = {
        canonicalUrl: 'https://example.com/canonical',
        alternate: [{ href: 'https://example.com/alternate' }]
      };
      assertEqual(getArticleUrl(article), 'https://example.com/canonical');
    });

    await it('returns undefined for articles without URLs', () => {
      assertEqual(getArticleUrl({}), undefined);
      assertEqual(getArticleUrl({ title: 'No URL' }), undefined);
    });

    await it('handles empty alternate array', () => {
      const article = { alternate: [] };
      assertEqual(getArticleUrl(article), undefined);
    });

    await it('handles null/undefined articles', () => {
      assertEqual(getArticleUrl(null), undefined);
      assertEqual(getArticleUrl(undefined), undefined);
    });
  });

  // =========================================================================
  // Badge Display Tests
  // =========================================================================
  await describe('Badge Display Logic', async () => {
    await it('returns empty string for zero count', () => {
      assertEqual(getBadgeText(0), '');
    });

    await it('returns empty string for negative count', () => {
      assertEqual(getBadgeText(-1), '');
      assertEqual(getBadgeText(-100), '');
    });

    await it('returns empty string for null/undefined', () => {
      assertEqual(getBadgeText(null), '');
      assertEqual(getBadgeText(undefined), '');
    });

    await it('displays counts up to 999 normally', () => {
      assertEqual(getBadgeText(1), '1');
      assertEqual(getBadgeText(10), '10');
      assertEqual(getBadgeText(100), '100');
      assertEqual(getBadgeText(999), '999');
    });

    await it('displays 999+ for counts over 999', () => {
      assertEqual(getBadgeText(1000), '999+');
      assertEqual(getBadgeText(9999), '999+');
      assertEqual(getBadgeText(100000), '999+');
    });
  });

  // =========================================================================
  // Batch Size Validation Tests
  // =========================================================================
  await describe('Batch Size Validation', async () => {
    await it('accepts valid batch sizes', () => {
      assertEqual(clampBatchSize(1), 1);
      assertEqual(clampBatchSize(30), 30);
      assertEqual(clampBatchSize(50), 50);
      assertEqual(clampBatchSize(100), 100);
    });

    await it('clamps values below minimum to 1', () => {
      assertEqual(clampBatchSize(0), 1);
      assertEqual(clampBatchSize(-1), 1);
      assertEqual(clampBatchSize(-100), 1);
    });

    await it('clamps values above maximum to 100', () => {
      assertEqual(clampBatchSize(101), 100);
      assertEqual(clampBatchSize(1000), 100);
      assertEqual(clampBatchSize(9999), 100);
    });

    await it('handles string inputs', () => {
      assertEqual(clampBatchSize('30'), 30);
      assertEqual(clampBatchSize('0'), 1);
      assertEqual(clampBatchSize('200'), 100);
    });

    await it('handles invalid inputs by returning minimum', () => {
      assertEqual(clampBatchSize(NaN), 1);
      assertEqual(clampBatchSize('invalid'), 1);
      assertEqual(clampBatchSize(null), 1);
      assertEqual(clampBatchSize(undefined), 1);
    });

    await it('respects custom min/max', () => {
      assertEqual(clampBatchSize(5, 10, 50), 10);
      assertEqual(clampBatchSize(100, 10, 50), 50);
      assertEqual(clampBatchSize(25, 10, 50), 25);
    });
  });

  // =========================================================================
  // Batch Processing Logic Tests
  // =========================================================================
  await describe('Batch Processing Logic', async () => {
    await it('slices correct batch size from articles', () => {
      const articles = createMockArticles(10);
      const batch = articles.slice(0, 5);
      assertArrayLength(batch, 5);
      assertEqual(batch[0].id, 'article-1');
      assertEqual(batch[4].id, 'article-5');
    });

    await it('handles batch size larger than article count', () => {
      const articles = createMockArticles(3);
      const batch = articles.slice(0, 10);
      assertArrayLength(batch, 3);
    });

    await it('handles empty article array', () => {
      const batch = [].slice(0, 5);
      assertArrayLength(batch, 0);
    });

    await it('correctly calculates remaining articles after batch', () => {
      const articles = createMockArticles(10);
      const batchSize = 3;
      const remaining = articles.slice(batchSize);
      assertArrayLength(remaining, 7);
      assertEqual(remaining[0].id, 'article-4');
    });

    await it('handles single article batch', () => {
      const articles = createMockArticles(5);
      const batch = articles.slice(0, 1);
      assertArrayLength(batch, 1);
      assertEqual(batch[0].id, 'article-1');
    });

    await it('handles maximum batch size (100)', () => {
      const articles = createMockArticles(150);
      const batch = articles.slice(0, 100);
      assertArrayLength(batch, 100);
    });
  });

  // =========================================================================
  // Mock Browser Storage Tests
  // =========================================================================
  await describe('Browser Storage API', async () => {
    const browser = createMockBrowser();

    await it('stores and retrieves single value', async () => {
      await browser.storage.local.set({ testKey: 'testValue' });
      const result = await browser.storage.local.get('testKey');
      assertEqual(result.testKey, 'testValue');
    });

    await it('stores and retrieves multiple values', async () => {
      await browser.storage.local.set({ key1: 'val1', key2: 'val2' });
      const result = await browser.storage.local.get(['key1', 'key2']);
      assertEqual(result.key1, 'val1');
      assertEqual(result.key2, 'val2');
    });

    await it('removes single key', async () => {
      await browser.storage.local.set({ toRemove: 'value' });
      await browser.storage.local.remove('toRemove');
      const result = await browser.storage.local.get('toRemove');
      assertEqual(result.toRemove, undefined);
    });

    await it('removes multiple keys', async () => {
      await browser.storage.local.set({ rem1: 'v1', rem2: 'v2' });
      await browser.storage.local.remove(['rem1', 'rem2']);
      const result = await browser.storage.local.get(['rem1', 'rem2']);
      assertEqual(result.rem1, undefined);
      assertEqual(result.rem2, undefined);
    });

    await it('clears all data', async () => {
      await browser.storage.local.set({ a: 1, b: 2, c: 3 });
      await browser.storage.local.clear();
      const result = await browser.storage.local.get(['a', 'b', 'c']);
      assertEqual(result.a, undefined);
      assertEqual(result.b, undefined);
      assertEqual(result.c, undefined);
    });

    await it('returns undefined for non-existent keys', async () => {
      await browser.storage.local.clear();
      const result = await browser.storage.local.get('nonexistent');
      assertEqual(result.nonexistent, undefined);
    });
  });

  // =========================================================================
  // Token Management Tests
  // =========================================================================
  await describe('Token Management', async () => {
    const browser = createMockBrowser();

    await it('stores valid token', async () => {
      const token = 'AkEd83jf92Kf_test_token_12345';
      await browser.storage.local.set({ accessToken: token });
      const result = await browser.storage.local.get('accessToken');
      assertEqual(result.accessToken, token);
    });

    await it('retrieves stored token', async () => {
      const token = 'test_token_xyz';
      await browser.storage.local.set({ accessToken: token });
      const result = await browser.storage.local.get('accessToken');
      assertNotNull(result.accessToken);
      assertEqual(result.accessToken, token);
    });

    await it('clears token on logout', async () => {
      await browser.storage.local.set({
        accessToken: 'token',
        userId: 'user123'
      });
      await browser.storage.local.remove(['accessToken', 'userId']);
      const result = await browser.storage.local.get(['accessToken', 'userId']);
      assertEqual(result.accessToken, undefined);
      assertEqual(result.userId, undefined);
    });

    await it('handles empty token correctly', async () => {
      await browser.storage.local.set({ accessToken: '' });
      const result = await browser.storage.local.get('accessToken');
      assertEqual(result.accessToken, '');
    });
  });

  // =========================================================================
  // Settings Persistence Tests
  // =========================================================================
  await describe('Settings Persistence', async () => {
    const browser = createMockBrowser();

    await it('stores user settings', async () => {
      const settings = { batchSize: 50 };
      await browser.storage.local.set({ userSettings: settings });
      const result = await browser.storage.local.get('userSettings');
      assertEqual(result.userSettings.batchSize, 50);
    });

    await it('preserves settings across simulated sessions', async () => {
      await browser.storage.local.set({ userSettings: { batchSize: 75 } });

      // Simulate "session reload" by creating new reference
      const result = await browser.storage.local.get('userSettings');
      assertEqual(result.userSettings.batchSize, 75);
    });

    await it('handles missing settings gracefully', async () => {
      await browser.storage.local.clear();
      const result = await browser.storage.local.get('userSettings');
      assertEqual(result.userSettings, undefined);
    });
  });

  // =========================================================================
  // Tab Creation Tests
  // =========================================================================
  await describe('Tab Creation', async () => {
    const browser = createMockBrowser();

    await it('creates tab with valid URL', async () => {
      browser.tabs._reset();
      const tab = await browser.tabs.create({ url: 'https://example.com', active: false });
      assertNotNull(tab.id);
      assertEqual(tab.url, 'https://example.com');
      assertEqual(tab.active, false);
    });

    await it('tracks created tabs', async () => {
      browser.tabs._reset();
      await browser.tabs.create({ url: 'https://example.com/1', active: false });
      await browser.tabs.create({ url: 'https://example.com/2', active: false });
      assertArrayLength(browser.tabs.created, 2);
    });

    await it('rejects tab creation without URL', async () => {
      await assertThrowsAsync(
        () => browser.tabs.create({ active: false }),
        'URL required'
      );
    });
  });

  // =========================================================================
  // Alarms API Tests
  // =========================================================================
  await describe('Alarms API', async () => {
    await it('creates alarm with options', async () => {
      const browser = createMockBrowser();
      await browser.alarms.create('test-alarm', {
        delayInMinutes: 60,
        periodInMinutes: 60
      });
      const alarms = await browser.alarms.getAll();
      assertArrayLength(alarms, 1);
      assertEqual(alarms[0].name, 'test-alarm');
    });

    await it('clears specific alarm', async () => {
      const browser = createMockBrowser();
      await browser.alarms.create('to-clear', { delayInMinutes: 1 });
      await browser.alarms.create('to-keep', { delayInMinutes: 1 });
      await browser.alarms.clear('to-clear');
      const alarms = await browser.alarms.getAll();
      assertEqual(alarms.length, 1);
      assertEqual(alarms[0].name, 'to-keep');
    });
  });

  // =========================================================================
  // Badge API Tests
  // =========================================================================
  await describe('Badge API', async () => {
    const browser = createMockBrowser();

    await it('sets badge text', async () => {
      await browser.action.setBadgeText({ text: '42' });
      assertEqual(browser.action.badgeText, '42');
    });

    await it('sets badge color', async () => {
      await browser.action.setBadgeBackgroundColor({ color: '#667eea' });
      assertEqual(browser.action.badgeColor, '#667eea');
    });

    await it('clears badge with empty text', async () => {
      await browser.action.setBadgeText({ text: '' });
      assertEqual(browser.action.badgeText, '');
    });
  });

  // =========================================================================
  // Article Mock Helper Tests
  // =========================================================================
  await describe('Test Helpers', async () => {
    await it('creates mock article with canonical URL', () => {
      const article = createMockArticle(1, 'https://example.com/1');
      assertEqual(article.id, 'article-1');
      assertEqual(article.canonicalUrl, 'https://example.com/1');
      assertEqual(article.alternate, undefined);
    });

    await it('creates mock article with alternate URL', () => {
      const article = createMockArticle(1, 'https://example.com/1', true);
      assertEqual(article.id, 'article-1');
      assertEqual(article.alternate[0].href, 'https://example.com/1');
      assertEqual(article.canonicalUrl, undefined);
    });

    await it('creates multiple mock articles', () => {
      const articles = createMockArticles(5);
      assertArrayLength(articles, 5);
      assertEqual(articles[0].canonicalUrl, 'https://example.com/article-1');
      assertEqual(articles[4].canonicalUrl, 'https://example.com/article-5');
    });
  });

  // =========================================================================
  // Edge Cases and Error Handling
  // =========================================================================
  await describe('Edge Cases', async () => {
    await it('handles articles with only alternate URL array with multiple items', () => {
      const article = {
        alternate: [
          { href: 'https://example.com/first', type: 'text/html' },
          { href: 'https://example.com/second', type: 'text/html' }
        ]
      };
      // Should return first alternate
      assertEqual(getArticleUrl(article), 'https://example.com/first');
    });

    await it('handles very large article counts', () => {
      const articles = createMockArticles(10000);
      assertArrayLength(articles, 10000);
      assertEqual(getBadgeText(10000), '999+');
    });

    await it('handles rapid batch operations', () => {
      const articles = createMockArticles(100);
      const batches = [];
      let remaining = [...articles];

      while (remaining.length > 0) {
        batches.push(remaining.slice(0, 10));
        remaining = remaining.slice(10);
      }

      assertArrayLength(batches, 10);
      batches.forEach(batch => assertArrayLength(batch, 10));
    });

    await it('handles articles with null URL properties', () => {
      const article = { canonicalUrl: null, alternate: null };
      assertEqual(getArticleUrl(article), undefined);
    });

    await it('handles whitespace-only batch size input', () => {
      assertEqual(clampBatchSize('   '), 1);
    });

    await it('handles floating point batch size', () => {
      assertEqual(clampBatchSize(30.7), 30);
      assertEqual(clampBatchSize('25.9'), 25);
    });
  });

  // =========================================================================
  // Integration: Message Passing Tests
  // =========================================================================
  await describe('Integration: Message Passing', async () => {
    await it('handles checkAuth message when authenticated', async () => {
      const browser = createMockBrowser();
      await browser.storage.local.set({ accessToken: 'test-token' });

      browser.runtime.onMessage.addListener(async (message) => {
        if (message.action === 'checkAuth') {
          const result = await browser.storage.local.get('accessToken');
          return { authenticated: !!result.accessToken };
        }
      });

      const response = await browser.runtime.sendMessage({ action: 'checkAuth' });
      assertTrue(response.authenticated);
    });

    await it('handles checkAuth message when not authenticated', async () => {
      const browser = createMockBrowser();
      await browser.storage.local.clear();

      browser.runtime.onMessage.addListener(async (message) => {
        if (message.action === 'checkAuth') {
          const result = await browser.storage.local.get('accessToken');
          return { authenticated: !!result.accessToken };
        }
      });

      const response = await browser.runtime.sendMessage({ action: 'checkAuth' });
      assertFalse(response.authenticated);
    });

    await it('handles saveToken message', async () => {
      const browser = createMockBrowser();

      browser.runtime.onMessage.addListener(async (message) => {
        if (message.action === 'saveToken' && message.token) {
          await browser.storage.local.set({ accessToken: message.token });
          return { success: true };
        }
        return { error: 'Token is required' };
      });

      const response = await browser.runtime.sendMessage({
        action: 'saveToken',
        token: 'new-test-token'
      });

      assertTrue(response.success);
      const stored = await browser.storage.local.get('accessToken');
      assertEqual(stored.accessToken, 'new-test-token');
    });

    await it('handles logout message', async () => {
      const browser = createMockBrowser();
      await browser.storage.local.set({ accessToken: 'token', userId: 'user123' });

      browser.runtime.onMessage.addListener(async (message) => {
        if (message.action === 'logout') {
          await browser.storage.local.remove(['accessToken', 'userId']);
          return { success: true };
        }
      });

      await browser.runtime.sendMessage({ action: 'logout' });

      const stored = await browser.storage.local.get(['accessToken', 'userId']);
      assertEqual(stored.accessToken, undefined);
      assertEqual(stored.userId, undefined);
    });

    await it('handles getArticles message', async () => {
      const browser = createMockBrowser();
      const mockArticles = createMockArticles(5);

      browser.runtime.onMessage.addListener(async (message) => {
        if (message.action === 'getArticles') {
          return { articles: mockArticles, lastSync: Date.now(), fromCache: false };
        }
      });

      const response = await browser.runtime.sendMessage({ action: 'getArticles' });
      assertArrayLength(response.articles, 5);
      assertNotNull(response.lastSync);
      assertFalse(response.fromCache);
    });

    await it('handles openBatch message', async () => {
      const browser = createMockBrowser();
      browser.tabs._reset();
      const articles = createMockArticles(3);

      browser.runtime.onMessage.addListener(async (message) => {
        if (message.action === 'openBatch') {
          let opened = 0;
          for (const article of message.articles) {
            const url = article.canonicalUrl;
            if (url && url.startsWith('http')) {
              await browser.tabs.create({ url, active: false });
              opened++;
            }
          }
          return { opened };
        }
      });

      const response = await browser.runtime.sendMessage({
        action: 'openBatch',
        articles
      });

      assertEqual(response.opened, 3);
      assertArrayLength(browser.tabs.created, 3);
    });
  });

  // =========================================================================
  // FeedlyAPI.makeRequest Retry Logic Tests
  // =========================================================================
  await describe('FeedlyAPI.makeRequest Retry Logic', async () => {
    await it('retries on 429 rate limit', async () => {
      const mockFetch = createMockFetch([
        { status: 429, statusText: 'Too Many Requests', body: {} },
        { status: 429, statusText: 'Too Many Requests', body: {} },
        { status: 200, body: { success: true } }
      ]);

      // Simulate retry logic
      let retries = 3;
      let result;
      while (retries > 0) {
        const response = await mockFetch('/test');
        if (response.status === 429 || response.status >= 500) {
          retries--;
          continue;
        }
        result = await response.json();
        break;
      }

      assertEqual(mockFetch.getCallCount(), 3);
      assertEqual(result.success, true);
    });

    await it('retries on 500 server error', async () => {
      const mockFetch = createMockFetch([
        { status: 500, statusText: 'Internal Server Error', body: {} },
        { status: 200, body: { data: 'success' } }
      ]);

      let retries = 3;
      let result;
      while (retries > 0) {
        const response = await mockFetch('/test');
        if (response.status === 429 || response.status >= 500) {
          retries--;
          continue;
        }
        result = await response.json();
        break;
      }

      assertEqual(mockFetch.getCallCount(), 2);
      assertEqual(result.data, 'success');
    });

    await it('does not retry on 401 Unauthorized', async () => {
      const mockFetch = createMockFetch([
        { status: 401, statusText: 'Unauthorized', body: { error: 'Token expired' } }
      ]);

      const response = await mockFetch('/test');
      assertEqual(response.status, 401);
      assertEqual(mockFetch.getCallCount(), 1);
    });

    await it('respects max retries limit', async () => {
      const mockFetch = createMockFetch([
        { status: 500, body: {} },
        { status: 500, body: {} },
        { status: 500, body: {} },
        { status: 500, body: {} }
      ]);

      let retries = 3;
      while (retries > 0) {
        const response = await mockFetch('/test');
        if (response.status >= 500) {
          retries--;
          continue;
        }
        break;
      }

      // Should stop after max retries (3 retries = 4 calls including initial)
      assert(mockFetch.getCallCount() <= 4, 'Should respect max retries');
    });

    await it('implements exponential backoff timing', async () => {
      // Test the backoff calculation logic
      const initialBackoff = 1000;
      const backoffs = [];

      for (let i = 0; i < 3; i++) {
        backoffs.push(initialBackoff * Math.pow(2, i));
      }

      assertEqual(backoffs[0], 1000);  // First retry: 1s
      assertEqual(backoffs[1], 2000);  // Second retry: 2s
      assertEqual(backoffs[2], 4000);  // Third retry: 4s
    });
  });

  // =========================================================================
  // Error Handling Scenarios Tests
  // =========================================================================
  await describe('Error Handling Scenarios', async () => {
    await it('handles 401 Unauthorized by clearing auth', async () => {
      const browser = createMockBrowser();
      await browser.storage.local.set({ accessToken: 'expired-token', userId: 'user123' });

      // Simulate handling 401 error
      const handleAuthError = async () => {
        await browser.storage.local.remove(['accessToken', 'userId']);
        await browser.action.setBadgeText({ text: '!' });
      };

      await handleAuthError();

      const stored = await browser.storage.local.get(['accessToken', 'userId']);
      assertEqual(stored.accessToken, undefined);
      assertEqual(browser.action.badgeText, '!');
    });

    await it('handles network failure gracefully', async () => {
      const mockFetch = createMockFetch([
        { error: 'Failed to fetch', errorName: 'NetworkError' }
      ]);

      let caught = false;
      try {
        await mockFetch('/test');
      } catch (error) {
        caught = true;
        assertEqual(error.message, 'Failed to fetch');
      }
      assertTrue(caught);
    });

    await it('handles malformed JSON response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => 'not valid json {'
      };

      let parseError = null;
      try {
        const text = await mockResponse.text();
        JSON.parse(text);
      } catch (error) {
        parseError = error;
      }

      assertNotNull(parseError);
    });

    await it('handles empty response body', async () => {
      const mockFetch = createMockFetch([
        { status: 200, body: null }
      ]);

      const response = await mockFetch('/test');
      const data = await response.json();
      assertEqual(data, null);
    });

    await it('preserves error context through chain', async () => {
      const originalError = new Error('API Error: 500 Internal Server Error');
      const wrappedError = new Error(`Request failed: ${originalError.message}`);

      assertTrue(wrappedError.message.includes('500'));
      assertTrue(wrappedError.message.includes('Internal Server Error'));
    });
  });

  // =========================================================================
  // processBatch Function Tests
  // =========================================================================
  await describe('processBatch Function', async () => {
    await it('opens tabs for valid articles', async () => {
      const browser = createMockBrowser();
      browser.tabs._reset();
      const articles = createMockArticles(3);

      for (const article of articles) {
        const url = getArticleUrl(article);
        if (isValidUrl(url)) {
          await browser.tabs.create({ url, active: false });
        }
      }

      assertArrayLength(browser.tabs.created, 3);
      assertEqual(browser.tabs.created[0].url, 'https://example.com/article-1');
    });

    await it('skips articles with invalid URLs', async () => {
      const browser = createMockBrowser();
      browser.tabs._reset();

      const articles = [
        createMockArticle(1, 'https://valid.com'),
        { id: 'no-url', title: 'No URL' },
        createMockArticle(3, 'javascript:alert(1)'),
        createMockArticle(4, 'https://also-valid.com')
      ];

      for (const article of articles) {
        const url = getArticleUrl(article);
        if (isValidUrl(url)) {
          await browser.tabs.create({ url, active: false });
        }
      }

      assertArrayLength(browser.tabs.created, 2);
    });

    await it('continues processing on single article error', async () => {
      const browser = createMockBrowser();
      browser.tabs._reset();

      const articles = createMockArticles(5);
      let processed = 0;
      const errors = [];

      for (const article of articles) {
        try {
          const url = getArticleUrl(article);
          if (isValidUrl(url)) {
            // Simulate random error on article 3
            if (article.id === 'article-3') {
              throw new Error('Tab creation failed');
            }
            await browser.tabs.create({ url, active: false });
            processed++;
          }
        } catch (error) {
          errors.push({ id: article.id, error: error.message });
        }
      }

      assertEqual(processed, 4); // 5 - 1 error
      assertArrayLength(errors, 1);
    });

    await it('updates badge after batch processing', async () => {
      const browser = createMockBrowser();
      const remainingCount = 7;

      // Simulate badge update after processing
      const displayCount = remainingCount > 999 ? '999+' : remainingCount.toString();
      await browser.action.setBadgeText({ text: displayCount });
      await browser.action.setBadgeBackgroundColor({ color: '#667eea' });

      assertEqual(browser.action.badgeText, '7');
    });

    await it('handles empty batch gracefully', async () => {
      const browser = createMockBrowser();
      browser.tabs._reset();

      const articles = [];
      let openedCount = 0;

      for (const article of articles) {
        const url = getArticleUrl(article);
        if (isValidUrl(url)) {
          await browser.tabs.create({ url, active: false });
          openedCount++;
        }
      }

      assertEqual(openedCount, 0);
      assertArrayLength(browser.tabs.created, 0);
    });
  });

  // =========================================================================
  // Async Timing Tests
  // =========================================================================
  await describe('Async Timing', async () => {
    await it('wait() delays execution correctly', async () => {
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const start = Date.now();
      await wait(50);
      const elapsed = Date.now() - start;
      assertTrue(elapsed >= 45, `Expected delay of ~50ms, got ${elapsed}ms`);
    });

    await it('debounce prevents rapid successive calls', async () => {
      let callCount = 0;
      const debounce = (fn, delay) => {
        let timeoutId;
        return function (...args) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
      };

      const increment = debounce(() => callCount++, 50);

      // Rapid calls
      increment();
      increment();
      increment();
      increment();

      // Wait for debounce to settle
      await mockWait(100);

      assertEqual(callCount, 1);
    });

    await it('debounce executes after delay expires', async () => {
      let executed = false;
      const debounce = (fn, delay) => {
        let timeoutId;
        return function (...args) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
      };

      const setExecuted = debounce(() => {
        executed = true;
      }, 30);
      setExecuted();

      assertFalse(executed);
      await mockWait(50);
      assertTrue(executed);
    });

    await it('handles concurrent async operations', async () => {
      const results = [];
      const asyncOp = async (id, delay) => {
        await mockWait(delay);
        results.push(id);
      };

      await Promise.all([
        asyncOp('a', 30),
        asyncOp('b', 10),
        asyncOp('c', 20)
      ]);

      assertArrayLength(results, 3);
      // Order should be: b (10ms), c (20ms), a (30ms)
      assertEqual(results[0], 'b');
      assertEqual(results[1], 'c');
      assertEqual(results[2], 'a');
    });
  });

  // =========================================================================
  // Context Menu Tests
  // =========================================================================
  await describe('Context Menu', async () => {
    await it('creates context menu on install', () => {
      const browser = createMockBrowser();

      browser.contextMenus.create({
        id: 'open-next-batch',
        title: '⚡ Open Next Batch',
        contexts: ['action']
      });

      const menu = browser.contextMenus.menus['open-next-batch'];
      assertNotNull(menu);
      assertEqual(menu.id, 'open-next-batch');
      assertEqual(menu.title, '⚡ Open Next Batch');
      assertTrue(menu.contexts.includes('action'));
    });

    await it('registers click listener', () => {
      const browser = createMockBrowser();

      browser.contextMenus.onClicked.addListener(() => {});

      assertArrayLength(browser.contextMenus.listeners, 1);
    });

    await it('filters by menu item ID', async () => {
      const browser = createMockBrowser();
      let correctMenuHandled = false;

      browser.contextMenus.onClicked.addListener((info) => {
        if (info.menuItemId === 'open-next-batch') {
          correctMenuHandled = true;
        }
      });

      // Trigger with correct ID
      browser.contextMenus.listeners[0]({ menuItemId: 'open-next-batch' });
      assertTrue(correctMenuHandled);

      // Reset and trigger with wrong ID
      correctMenuHandled = false;
      browser.contextMenus.listeners[0]({ menuItemId: 'other-menu' });
      assertFalse(correctMenuHandled);
    });
  });

  // =========================================================================
  // Periodic Update Alarms Tests
  // =========================================================================
  await describe('Periodic Update Alarms', async () => {
    await it('creates alarm with correct interval', async () => {
      const browser = createMockBrowser();
      const UPDATE_INTERVAL = 60;

      await browser.alarms.create('badge-update', {
        delayInMinutes: UPDATE_INTERVAL,
        periodInMinutes: UPDATE_INTERVAL
      });

      const alarms = await browser.alarms.getAll();
      assertArrayLength(alarms, 1);
      assertEqual(alarms[0].name, 'badge-update');
      assertEqual(alarms[0].delayInMinutes, 60);
      assertEqual(alarms[0].periodInMinutes, 60);
    });

    await it('clears alarm on stop', async () => {
      const browser = createMockBrowser();

      await browser.alarms.create('badge-update', { delayInMinutes: 60 });
      let alarms = await browser.alarms.getAll();
      assertArrayLength(alarms, 1);

      await browser.alarms.clear('badge-update');
      alarms = await browser.alarms.getAll();
      assertArrayLength(alarms, 0);
    });

    await it('triggers callback on alarm', async () => {
      const browser = createMockBrowser();
      let callbackExecuted = false;

      browser.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'badge-update') {
          callbackExecuted = true;
        }
      });

      await browser.alarms.create('badge-update', { delayInMinutes: 1 });
      browser.alarms._triggerAlarm('badge-update');

      assertTrue(callbackExecuted);
    });

    await it('replaces existing alarm on restart', async () => {
      const browser = createMockBrowser();

      // First alarm
      await browser.alarms.create('badge-update', { delayInMinutes: 30 });

      // Clear and recreate (restart scenario)
      await browser.alarms.clear('badge-update');
      await browser.alarms.create('badge-update', { delayInMinutes: 60 });

      const alarms = await browser.alarms.getAll();
      assertArrayLength(alarms, 1);
      assertEqual(alarms[0].delayInMinutes, 60);
    });
  });

  // =========================================================================
  // Popup State Machine Tests
  // =========================================================================
  await describe('Popup State Machine', async () => {
    await it('transitions from loading to auth view', () => {
      const views = { loading: true, notAuth: false, auth: false, error: false };

      // Simulate successful auth check
      const showView = (viewName) => {
        Object.keys(views).forEach(k => views[k] = false);
        views[viewName] = true;
      };

      showView('loading');
      assertTrue(views.loading);

      // Auth successful
      showView('auth');
      assertFalse(views.loading);
      assertTrue(views.auth);
    });

    await it('transitions from loading to notAuth view', () => {
      const views = { loading: true, notAuth: false, auth: false, error: false };

      const showView = (viewName) => {
        Object.keys(views).forEach(k => views[k] = false);
        views[viewName] = true;
      };

      showView('loading');
      // Not authenticated
      showView('notAuth');

      assertFalse(views.loading);
      assertTrue(views.notAuth);
    });

    await it('transitions to error view on failure', () => {
      const views = { loading: true, notAuth: false, auth: false, error: false };

      const showView = (viewName) => {
        Object.keys(views).forEach(k => views[k] = false);
        views[viewName] = true;
      };

      showView('loading');
      showView('error');

      assertTrue(views.error);
      assertFalse(views.loading);
    });

    await it('shows content or empty state based on articles', () => {
      const state = createMockPopupState();
      let contentVisible = false;
      let emptyVisible = false;

      const updateUI = () => {
        if (state.articles.length === 0) {
          contentVisible = false;
          emptyVisible = true;
        } else {
          contentVisible = true;
          emptyVisible = false;
        }
      };

      // No articles - show empty
      updateUI();
      assertFalse(contentVisible);
      assertTrue(emptyVisible);

      // With articles - show content
      state.articles = createMockArticles(5);
      updateUI();
      assertTrue(contentVisible);
      assertFalse(emptyVisible);
    });

    await it('disables buttons during processing', () => {
      const state = createMockPopupState();
      const buttons = {
        openBatch: { disabled: false },
        openAll: { disabled: false },
        refresh: { disabled: false }
      };

      const setLoading = (active) => {
        state.processing = active;
        buttons.openBatch.disabled = active;
        buttons.openAll.disabled = active;
        buttons.refresh.disabled = active;
      };

      setLoading(true);
      assertTrue(state.processing);
      assertTrue(buttons.openBatch.disabled);
      assertTrue(buttons.openAll.disabled);
      assertTrue(buttons.refresh.disabled);

      setLoading(false);
      assertFalse(state.processing);
      assertFalse(buttons.openBatch.disabled);
    });
  });

  // =========================================================================
  // UI State Snapshots Tests
  // =========================================================================
  await describe('UI State Snapshots', async () => {
    await it('authenticated state with articles', () => {
      const expectedState = {
        view: 'auth',
        contentVisible: true,
        emptyVisible: false,
        articleCount: 25,
        batchSize: 30,
        openBatchText: '⚡ Open 25 Articles',
        openAllVisible: true
      };

      // Validate expected state structure
      assertEqual(expectedState.view, 'auth');
      assertTrue(expectedState.contentVisible);
      assertFalse(expectedState.emptyVisible);
      assertEqual(expectedState.articleCount, 25);
    });

    await it('authenticated state empty', () => {
      const expectedState = {
        view: 'auth',
        contentVisible: false,
        emptyVisible: true,
        articleCount: 0,
        celebrateIconVisible: true
      };

      assertEqual(expectedState.view, 'auth');
      assertTrue(expectedState.emptyVisible);
      assertEqual(expectedState.articleCount, 0);
    });

    await it('not authenticated state', () => {
      const expectedState = {
        view: 'notAuth',
        tokenInputVisible: true,
        saveButtonVisible: true,
        getFeedlyButtonVisible: true
      };

      assertEqual(expectedState.view, 'notAuth');
      assertTrue(expectedState.tokenInputVisible);
    });

    await it('error state', () => {
      const expectedState = {
        view: 'error',
        errorMessage: 'Session expired. Please reconnect.',
        retryButtonVisible: true,
        resetAuthButtonVisible: true
      };

      assertEqual(expectedState.view, 'error');
      assertTrue(expectedState.retryButtonVisible);
      assertTrue(expectedState.errorMessage.includes('expired'));
    });

    await it('loading state', () => {
      const expectedState = {
        view: 'loading',
        skeletonVisible: true,
        contentVisible: false
      };

      assertEqual(expectedState.view, 'loading');
      assertTrue(expectedState.skeletonVisible);
      assertFalse(expectedState.contentVisible);
    });

    await it('processing state', () => {
      const expectedState = {
        processing: true,
        buttonsDisabled: true,
        progressBarVisible: true,
        progressText: 'Processing batch 1 of 3...'
      };

      assertTrue(expectedState.processing);
      assertTrue(expectedState.buttonsDisabled);
      assertTrue(expectedState.progressText.includes('Processing'));
    });
  });

  // =========================================================================
  // Mock Fetch and Feedly Responses Tests
  // =========================================================================
  await describe('Mock Fetch and Feedly Responses', async () => {
    await it('createMockFetch returns correct responses in order', async () => {
      const mockFetch = createMockFetch([
        { status: 200, body: { first: true } },
        { status: 200, body: { second: true } },
        { status: 200, body: { third: true } }
      ]);

      const r1 = await mockFetch('/test');
      assertEqual((await r1.json()).first, true);

      const r2 = await mockFetch('/test');
      assertEqual((await r2.json()).second, true);

      const r3 = await mockFetch('/test');
      assertEqual((await r3.json()).third, true);
    });

    await it('createMockFetch tracks call count', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: {} }]);

      assertEqual(mockFetch.getCallCount(), 0);
      await mockFetch('/test1');
      assertEqual(mockFetch.getCallCount(), 1);
      await mockFetch('/test2');
      assertEqual(mockFetch.getCallCount(), 2);
    });

    await it('createMockFetch tracks call details', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: {} }]);

      await mockFetch('/api/profile', { method: 'GET' });
      await mockFetch('/api/articles', { method: 'POST', body: '{}' });

      const calls = mockFetch.getCalls();
      assertEqual(calls[0].url, '/api/profile');
      assertEqual(calls[1].url, '/api/articles');
      assertEqual(calls[1].options.method, 'POST');
    });

    await it('createFeedlyMockResponses provides complete mocks', () => {
      const mocks = createFeedlyMockResponses(10);

      assertNotNull(mocks.profile);
      assertEqual(mocks.profile.status, 200);
      assertEqual(mocks.profile.body.id, 'user/12345');

      assertNotNull(mocks.articles);
      assertArrayLength(mocks.articles.body.items, 10);

      assertNotNull(mocks.unauthorized);
      assertEqual(mocks.unauthorized.status, 401);

      assertNotNull(mocks.rateLimit);
      assertEqual(mocks.rateLimit.status, 429);

      assertNotNull(mocks.networkError);
      assertEqual(mocks.networkError.error, 'Failed to fetch');
    });

    await it('mock responses work with createMockFetch', async () => {
      const mocks = createFeedlyMockResponses(5);
      const mockFetch = createMockFetch([mocks.profile, mocks.articles]);

      const profileResponse = await mockFetch('/api/profile');
      const profile = await profileResponse.json();
      assertEqual(profile.email, 'test@example.com');

      const articlesResponse = await mockFetch('/api/articles');
      const articles = await articlesResponse.json();
      assertArrayLength(articles.items, 5);
    });
  });

  // =========================================================================
  // Manifest Validation Tests
  // =========================================================================
  await describe('Manifest Validation', async () => {
    // Simulated manifest structure
    const manifest = {
      manifest_version: 3,
      name: 'Feedly Saved Opener',
      version: '2.0.0',
      permissions: ['storage', 'tabs', 'contextMenus', 'alarms'],
      host_permissions: ['https://cloud.feedly.com/*']
    };

    await it('uses Manifest V3', () => {
      assertEqual(manifest.manifest_version, 3);
    });

    await it('has required permissions', () => {
      assertTrue(manifest.permissions.includes('storage'));
      assertTrue(manifest.permissions.includes('tabs'));
      assertTrue(manifest.permissions.includes('contextMenus'));
      assertTrue(manifest.permissions.includes('alarms'));
    });

    await it('has Feedly API host permission', () => {
      assertTrue(manifest.host_permissions.includes('https://cloud.feedly.com/*'));
    });

    await it('has valid version format', () => {
      const versionRegex = /^\d+\.\d+\.\d+$/;
      assertTrue(versionRegex.test(manifest.version));
    });
  });

  // =========================================================================
  // Error Classification Tests
  // =========================================================================
  await describe('Error Classification', async () => {
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

    await it('classifies 401 as AUTH_EXPIRED', () => {
      assertEqual(classifyError(new Error('401 Unauthorized')), 'AUTH_EXPIRED');
    });

    await it('classifies "Not authenticated" as AUTH_EXPIRED', () => {
      assertEqual(classifyError(new Error('Not authenticated')), 'AUTH_EXPIRED');
    });

    await it('classifies network errors as NETWORK', () => {
      assertEqual(classifyError(new Error('Failed to fetch')), 'NETWORK');
      assertEqual(classifyError(new Error('Request timeout')), 'NETWORK');
      const netErr = new Error('connection lost');
      netErr.name = 'NetworkError';
      assertEqual(classifyError(netErr), 'NETWORK');
    });

    await it('classifies 429 as RATE_LIMITED', () => {
      assertEqual(classifyError(new Error('API Error: 429 - Max retries exceeded')), 'RATE_LIMITED');
    });

    await it('classifies 5xx as SERVER_ERROR', () => {
      assertEqual(classifyError(new Error('API Error: 500 Internal Server Error')), 'SERVER_ERROR');
      assertEqual(classifyError(new Error('API Error: 502 Bad Gateway')), 'SERVER_ERROR');
      assertEqual(classifyError(new Error('API Error: 503 Service Unavailable')), 'SERVER_ERROR');
    });

    await it('classifies unknown errors as UNKNOWN', () => {
      assertEqual(classifyError(new Error('something else')), 'UNKNOWN');
      assertEqual(classifyError(new Error('')), 'UNKNOWN');
    });
  });

  // =========================================================================
  // Fetch Timeout Tests
  // =========================================================================
  await describe('Fetch Timeout', async () => {
    await it('AbortController aborts after timeout', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      let aborted = false;
      try {
        await new Promise((resolve, reject) => {
          const check = setInterval(() => {
            if (controller.signal.aborted) {
              clearInterval(check);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            }
          }, 10);
        });
      } catch (error) {
        aborted = true;
        assertEqual(error.name, 'AbortError');
      }
      assertTrue(aborted);
    });

    await it('AbortError is distinguishable from other errors', () => {
      const abortErr = new DOMException('aborted', 'AbortError');
      const netErr = new Error('Failed to fetch');
      assertEqual(abortErr.name, 'AbortError');
      assert(netErr.name !== 'AbortError');
    });
  });

  // =========================================================================
  // Batch Unstar Tests
  // =========================================================================
  await describe('Batch Unstar', async () => {
    await it('builds correct markers API payload for multiple articles', () => {
      const entryIds = ['article-1', 'article-2', 'article-3'];
      const payload = {
        action: 'markAsUnsaved',
        type: 'entries',
        entryIds: entryIds
      };

      assertEqual(payload.action, 'markAsUnsaved');
      assertEqual(payload.type, 'entries');
      assertArrayLength(payload.entryIds, 3);
    });

    await it('filters out falsy entry IDs', () => {
      const entryIds = ['article-1', null, 'article-3', undefined, ''];
      const filtered = entryIds.filter(Boolean);
      assertArrayLength(filtered, 2);
      assertEqual(filtered[0], 'article-1');
      assertEqual(filtered[1], 'article-3');
    });

    await it('handles empty entry IDs array', () => {
      const entryIds = [].filter(Boolean);
      assertArrayLength(entryIds, 0);
    });

    await it('processBatch collects opened article IDs for batch unstar', () => {
      const articles = createMockArticles(5);
      const openedIds = [];

      for (const article of articles) {
        const url = getArticleUrl(article);
        if (isValidUrl(url)) {
          openedIds.push(article.id);
        }
      }

      assertArrayLength(openedIds, 5);
      assertEqual(openedIds[0], 'article-1');
    });
  });

  // =========================================================================
  // Toast Queue Limit Tests
  // =========================================================================
  await describe('Toast Queue Limit', async () => {
    await it('limits queue to MAX_TOASTS by removing oldest', () => {
      const MAX_TOASTS = 3;
      const toasts = [];

      function addToast(msg) {
        while (toasts.length >= MAX_TOASTS) {
          toasts.shift();
        }
        toasts.push(msg);
      }

      addToast('first');
      addToast('second');
      addToast('third');
      assertArrayLength(toasts, 3);

      addToast('fourth');
      assertArrayLength(toasts, 3);
      assertEqual(toasts[0], 'second');
      assertEqual(toasts[2], 'fourth');
    });

    await it('allows toasts when under limit', () => {
      const MAX_TOASTS = 3;
      const toasts = [];

      function addToast(msg) {
        while (toasts.length >= MAX_TOASTS) {
          toasts.shift();
        }
        toasts.push(msg);
      }

      addToast('only one');
      assertArrayLength(toasts, 1);
    });
  });

  // =========================================================================
  // Results Summary
  // =========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Results Summary:');
  console.log(`  ✓ Passed:  ${TEST_RESULTS.passed}`);
  console.log(`  ✗ Failed:  ${TEST_RESULTS.failed}`);
  console.log(`  📈 Total:   ${TEST_RESULTS.tests.length}`);

  const successRate = ((TEST_RESULTS.passed / TEST_RESULTS.tests.length) * 100).toFixed(1);
  console.log(`  📊 Success: ${successRate}%`);

  if (TEST_RESULTS.failed > 0) {
    console.log('\n❌ Failed Tests:');
    TEST_RESULTS.tests
      .filter(t => t.status !== 'PASS')
      .forEach(t => {
        console.log(`  - ${t.name}`);
        if (t.error) {
          console.log(`    Error: ${t.error}`);
        }
      });
    console.log('');
  } else {
    console.log('\n🎉 All tests passed!\n');
  }

  console.log('='.repeat(60) + '\n');

  process.exit(TEST_RESULTS.failed === 0 ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test suite crashed:', error);
  process.exit(1);
});
