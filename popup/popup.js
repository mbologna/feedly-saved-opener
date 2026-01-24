// UI Elements
const views = {
  loading: document.getElementById('loading'),
  notAuth: document.getElementById('not-authenticated'),
  auth: document.getElementById('authenticated'),
  error: document.getElementById('error-state'),
  content: document.getElementById('content-view'),
  empty: document.getElementById('empty-state')
};

const elements = {
  articleCount: document.getElementById('article-count'),
  openBatchBtn: document.getElementById('open-batch-btn'),
  openAllBtn: document.getElementById('open-all-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  saveTokenBtn: document.getElementById('save-token-btn'),
  openFeedlyBtn: document.getElementById('open-feedly-btn'),
  goToFeedlyBtn: document.getElementById('go-to-feedly-btn'),
  tokenInput: document.getElementById('token-input'),
  logoutBtn: document.getElementById('logout-btn'),
  resetAuthBtn: document.getElementById('reset-auth-btn'),
  retryBtn: document.getElementById('retry-btn'),
  errorMsg: document.getElementById('error-message'),
  progressText: document.getElementById('progress-text'),
  batchSize: document.getElementById('batch-size-input')
};

// Application State
const state = {
  articles: [],
  batchSize: 30,
  processing: false
};

const STORAGE_KEY = 'userSettings';
const BATCH_SIZE_LIMITS = { min: 1, max: 100 };
const BATCH_COOLDOWN_MS = 1000;

/**
 * Initialize the popup
 */
async function init() {
  try {
    await loadSettings();
    await checkAuthAndLoad();
    setupEventListeners();
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize. Please try again.', true);
  }
}

/**
 * Load user settings from storage
 */
async function loadSettings() {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY] && result[STORAGE_KEY].batchSize) {
      state.batchSize = clampBatchSize(result[STORAGE_KEY].batchSize);
    }
    elements.batchSize.value = state.batchSize;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

/**
 * Save user settings to storage
 */
async function saveSettings() {
  try {
    const value = parseInt(elements.batchSize.value, 10);
    state.batchSize = clampBatchSize(value);
    elements.batchSize.value = state.batchSize;

    await browser.storage.local.set({
      [STORAGE_KEY]: { batchSize: state.batchSize }
    });

    updateUI();
  } catch (error) {
    console.error('Failed to save settings:', error);
    showError('Failed to save settings');
  }
}

/**
 * Clamp batch size to valid range
 */
function clampBatchSize(value) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return BATCH_SIZE_LIMITS.min;
  }
  return Math.max(BATCH_SIZE_LIMITS.min, Math.min(BATCH_SIZE_LIMITS.max, num));
}

/**
 * Show specific view and hide others
 */
function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  if (views[viewName]) {
    views[viewName].classList.remove('hidden');
  }
}

/**
 * Update UI based on current state
 */
function updateUI() {
  const count = state.articles.length;

  if (count === 0) {
    views.content.classList.add('hidden');
    views.empty.classList.remove('hidden');
    elements.progressText.textContent = '';
    return;
  }

  views.content.classList.remove('hidden');
  views.empty.classList.add('hidden');

  elements.articleCount.textContent = `${count} Saved Article${count !== 1 ? 's' : ''}`;

  const openCount = Math.min(state.batchSize, count);
  elements.openBatchBtn.textContent = `⚡ Open ${openCount} Article${openCount !== 1 ? 's' : ''}`;

  // Show/hide "Open All" button
  if (count > state.batchSize) {
    elements.openAllBtn.classList.remove('hidden');
  } else {
    elements.openAllBtn.classList.add('hidden');
  }
}

/**
 * Set loading state for buttons
 */
function setLoading(active, btn = null) {
  state.processing = active;

  if (btn) {
    if (active) {
      btn.dataset.original = btn.textContent;
      btn.textContent = 'Processing...';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.original || btn.textContent;
      btn.disabled = false;
      delete btn.dataset.original;
    }
  }

  // Disable all action buttons when processing
  elements.refreshBtn.disabled = active;
  elements.openAllBtn.disabled = active;
  elements.openBatchBtn.disabled = active;
}

/**
 * Check authentication and load articles
 */
async function checkAuthAndLoad() {
  showView('loading');

  try {
    const response = await browser.runtime.sendMessage({ action: 'checkAuth' });

    if (response.authenticated) {
      showView('auth');
      await loadArticles();
    } else {
      showView('notAuth');
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    showError('Could not connect to extension. Please reload.', true);
  }
}

/**
 * Load articles from Feedly
 */
async function loadArticles() {
  elements.articleCount.textContent = 'Loading...';

  try {
    const response = await browser.runtime.sendMessage({ action: 'getArticles' });

    if (response.error) {
      throw new Error(response.error);
    }

    state.articles = Array.isArray(response.articles) ? response.articles : [];
    updateUI();

  } catch (error) {
    console.error('Failed to load articles:', error);

    // Handle authentication errors
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      await logout();
      showError('Session expired. Please reconnect.', true);
    } else {
      elements.articleCount.textContent = 'Error loading';
      showError('Failed to load articles: ' + error.message);
    }
  }
}

/**
 * Open a batch of articles
 */
async function openBatch(articlesToProcess = null) {
  if (state.processing && !articlesToProcess) {
    return;
  }

  const batchSize = Math.min(state.batchSize, state.articles.length);
  const targetArticles = articlesToProcess || state.articles.slice(0, batchSize);

  if (targetArticles.length === 0) {
    showError('No articles to open');
    return 0;
  }

  if (!articlesToProcess) {
    setLoading(true, elements.openBatchBtn);
  }

  elements.progressText.textContent = `Opening ${targetArticles.length} tabs...`;

  try {
    const response = await browser.runtime.sendMessage({
      action: 'openBatch',
      articles: targetArticles
    });

    if (response.error) {
      throw new Error(response.error);
    }

    const openedCount = response.opened || 0;

    // Update local state
    if (!articlesToProcess) {
      state.articles = state.articles.slice(openedCount);
      updateUI();
    }

    elements.progressText.textContent = `Opened ${openedCount} article${openedCount !== 1 ? 's' : ''}`;

    // Clear progress text after delay
    setTimeout(() => {
      if (!state.processing) {
        elements.progressText.textContent = '';
      }
    }, 3000);

    return openedCount;

  } catch (error) {
    console.error('Failed to open batch:', error);
    showError('Failed to open articles: ' + error.message);
    return 0;
  } finally {
    if (!articlesToProcess) {
      setLoading(false, elements.openBatchBtn);
    }
  }
}

/**
 * Open all articles in smart batches
 */
async function openAllSmart() {
  if (state.processing || state.articles.length === 0) {
    return;
  }

  const totalCount = state.articles.length;
  const batchCount = Math.ceil(totalCount / state.batchSize);

  const confirmed = confirm(
    `This will open all ${totalCount} articles in ${batchCount} batch${batchCount !== 1 ? 'es' : ''} of ${state.batchSize}.\n\nContinue?`
  );

  if (!confirmed) {
    return;
  }

  setLoading(true, elements.openAllBtn);
  elements.openAllBtn.textContent = 'Processing All...';

  let totalOpened = 0;

  try {
    while (state.articles.length > 0) {
      const batchSize = Math.min(state.batchSize, state.articles.length);
      const batch = state.articles.slice(0, batchSize);
      const remaining = state.articles.length;

      elements.progressText.textContent = `Processing batch (${remaining} remaining)...`;

      const opened = await openBatch(batch);
      totalOpened += opened;

      // Update local state
      state.articles = state.articles.slice(batchSize);
      updateUI();

      // Cooldown between batches
      if (state.articles.length > 0) {
        elements.progressText.textContent = 'Cooling down...';
        await new Promise(resolve => setTimeout(resolve, BATCH_COOLDOWN_MS));
      }
    }

    elements.progressText.textContent = `Completed! Opened ${totalOpened} articles.`;

    // Close popup after successful completion
    setTimeout(() => window.close(), 1500);

  } catch (error) {
    console.error('Smart batch error:', error);
    showError('Batch processing failed: ' + error.message);
  } finally {
    setLoading(false, elements.openAllBtn);
    elements.openAllBtn.textContent = 'Open All (Smart Batch)';
  }
}

/**
 * Save authentication token
 */
async function saveToken() {
  const token = elements.tokenInput.value.trim();

  if (!token) {
    showError('Please enter a token');
    return;
  }

  setLoading(true, elements.saveTokenBtn);

  try {
    const response = await browser.runtime.sendMessage({
      action: 'saveToken',
      token
    });

    if (response.error) {
      throw new Error(response.error);
    }

    elements.tokenInput.value = '';
    await checkAuthAndLoad();

  } catch (error) {
    console.error('Failed to save token:', error);
    showError('Failed to authenticate. Please check your token.');
  } finally {
    setLoading(false, elements.saveTokenBtn);
  }
}

/**
 * Logout and clear authentication
 */
async function logout() {
  try {
    await browser.runtime.sendMessage({ action: 'logout' });
    state.articles = [];
    showView('notAuth');
  } catch (error) {
    console.error('Logout failed:', error);
    showError('Failed to logout');
  }
}

/**
 * Show error message
 */
function showError(msg, isFatal = false) {
  elements.errorMsg.textContent = msg;

  if (isFatal) {
    showView('error');
  } else {
    // Show as alert for non-fatal errors
    alert(msg);
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  elements.batchSize.addEventListener('change', saveSettings);
  elements.batchSize.addEventListener('blur', saveSettings);

  elements.openBatchBtn.addEventListener('click', () => openBatch());
  elements.openAllBtn.addEventListener('click', openAllSmart);
  elements.refreshBtn.addEventListener('click', loadArticles);

  elements.saveTokenBtn.addEventListener('click', saveToken);
  elements.tokenInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveToken();
    }
  });

  elements.logoutBtn.addEventListener('click', () => {
    if (confirm('Disconnect your Feedly account?')) {
      logout();
    }
  });

  elements.resetAuthBtn.addEventListener('click', logout);
  elements.retryBtn.addEventListener('click', checkAuthAndLoad);

  elements.openFeedlyBtn.addEventListener('click', () => {
    browser.tabs.create({ url: 'https://feedly.com/i/console' });
  });

  elements.goToFeedlyBtn.addEventListener('click', () => {
    browser.tabs.create({ url: 'https://feedly.com/i/saved' });
  });

  // Keyboard shortcuts
  document.addEventListener('keypress', (e) => {
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!state.processing) {
        loadArticles();
      }
    }
  });
}

// Initialize on load
init();
