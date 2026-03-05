/**
 * Feedly Saved Opener - Popup Script
 * Handles UI interactions and communicates with the background service worker
 */

// =============================================================================
// DOM Elements
// =============================================================================

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
  batchSize: document.getElementById('batch-size-input'),
  articleList: document.getElementById('article-list'),
  toggleListBtn: document.getElementById('toggle-list-btn'),
  progressContainer: document.getElementById('progress-container'),
  progressBar: document.getElementById('progress-bar'),
  batchPreview: document.getElementById('batch-preview'),
  lastSync: document.getElementById('last-sync'),
  exportBtn: document.getElementById('export-btn'),
  exportLogBtn: document.getElementById('export-log-btn'),
  toggleStatsBtn: document.getElementById('toggle-stats-btn'),
  statsSection: document.getElementById('stats-section'),
  statsSummary: document.getElementById('stats-summary'),
  statsTop10: document.getElementById('stats-top10'),
  clearLogBtn: document.getElementById('clear-log-btn'),
  toggleTokenVisibility: document.getElementById('toggle-token-visibility'),
  eyeIcon: document.getElementById('eye-icon'),
  confirmModal: document.getElementById('confirm-modal'),
  modalMessage: document.getElementById('modal-message'),
  modalCancel: document.getElementById('modal-cancel'),
  modalConfirm: document.getElementById('modal-confirm'),
  toastContainer: document.getElementById('toast-container')
};

// =============================================================================
// Configuration & State
// =============================================================================

const STORAGE_KEY = 'userSettings';
const BATCH_SIZE_LIMITS = { min: 1, max: 100 };
const BATCH_COOLDOWN_MS = 1000;
const SETTINGS_DEBOUNCE_MS = 300;
const PROGRESS_CLEAR_DELAY_MS = 3000;
const COMPLETION_CLOSE_DELAY_MS = 1500;
const MAX_TOASTS = 3;

/**
 * Application state
 * @type {{articles: Array, batchSize: number, processing: boolean}}
 */
const state = {
  articles: [],
  batchSize: 30,
  processing: false,
  lastSync: null,
  articleListVisible: false,
  statsVisible: false
};

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
 * Creates a debounced version of a function
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Debounce delay in ms
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

/**
 * Extracts the best available URL from an article object
 * @param {Object} article - Feedly article object
 * @returns {string|undefined}
 */
function getArticleUrl(article) {
  return article?.canonicalUrl || article?.alternate?.[0]?.href;
}

/**
 * Formats a timestamp as relative time (e.g., "2 minutes ago")
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted relative time
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '';
  }

  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} ${pluralize('minute', minutes)} ago`;
  }
  if (hours < 24) {
    return `${hours} ${pluralize('hour', hours)} ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initializes the popup by loading settings, checking auth, and setting up listeners
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

// =============================================================================
// Settings Management
// =============================================================================

/**
 * Loads user settings from browser storage
 */
async function loadSettings() {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]?.batchSize) {
      state.batchSize = clampBatchSize(result[STORAGE_KEY].batchSize);
    }
    elements.batchSize.value = state.batchSize;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

/**
 * Saves user settings to browser storage
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
 * Clamps batch size to valid range [1, 100]
 * @param {number|string} value - Value to clamp
 * @returns {number} Clamped batch size
 */
function clampBatchSize(value) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return BATCH_SIZE_LIMITS.min;
  }
  return Math.max(BATCH_SIZE_LIMITS.min, Math.min(BATCH_SIZE_LIMITS.max, num));
}

// =============================================================================
// Toast Notifications
// =============================================================================

/**
 * Shows a toast notification
 * @param {string} message - Message to display
 * @param {'info'|'success'|'error'} type - Toast type
 * @param {number} duration - Duration in milliseconds
 */
function showToast(message, type = 'info', duration = 3000) {
  while (elements.toastContainer.children.length >= MAX_TOASTS) {
    elements.toastContainer.removeChild(elements.toastContainer.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// =============================================================================
// Confirmation Modal
// =============================================================================

/**
 * Shows a confirmation modal and returns a promise
 * @param {string} message - Message to display
 * @returns {Promise<boolean>} Whether user confirmed
 */
function showConfirmModal(message) {
  return new Promise((resolve) => {
    elements.modalMessage.textContent = message;
    elements.confirmModal.classList.remove('hidden');

    const cleanup = () => {
      elements.confirmModal.classList.add('hidden');
      elements.modalConfirm.removeEventListener('click', onConfirm);
      elements.modalCancel.removeEventListener('click', onCancel);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    elements.modalConfirm.addEventListener('click', onConfirm);
    elements.modalCancel.addEventListener('click', onCancel);
  });
}

// =============================================================================
// Progress Bar
// =============================================================================

/**
 * Updates the progress bar
 * @param {number} current - Current progress value
 * @param {number} total - Total value
 */
function updateProgress(current, total) {
  if (total <= 0) {
    elements.progressContainer.classList.add('hidden');
    return;
  }

  const percentage = Math.min(100, Math.round((current / total) * 100));
  elements.progressContainer.classList.remove('hidden');
  elements.progressBar.style.width = `${percentage}%`;
}

/**
 * Hides the progress bar
 */
function hideProgress() {
  elements.progressContainer.classList.add('hidden');
  elements.progressBar.style.width = '0%';
}

// =============================================================================
// Article List Preview
// =============================================================================

/**
 * Renders the article list preview
 */
function renderArticleList() {
  if (state.articles.length === 0) {
    elements.articleList.classList.add('hidden');
    elements.toggleListBtn.classList.add('hidden');
    return;
  }

  elements.toggleListBtn.classList.remove('hidden');

  if (!state.articleListVisible) {
    elements.articleList.classList.add('hidden');
    elements.toggleListBtn.textContent = 'Show Articles';
    return;
  }

  const html = state.articles.slice(0, 50).map(article => {
    const title = escapeHtml(article.title || 'Untitled');
    const source = escapeHtml(article.origin?.title || 'Unknown source');
    return `
      <div class="article-item">
        <span class="article-item-title">${title}</span>
        <span class="article-item-source">${source}</span>
      </div>
    `;
  }).join('');

  elements.articleList.innerHTML = html;
  elements.articleList.classList.remove('hidden');
  elements.toggleListBtn.textContent = 'Hide Articles';
}

/**
 * Toggles article list visibility
 */
function toggleArticleList() {
  state.articleListVisible = !state.articleListVisible;
  renderArticleList();
}

// =============================================================================
// Batch Preview & Last Sync
// =============================================================================

/**
 * Updates the batch preview text
 */
function updateBatchPreview() {
  const count = state.articles.length;
  if (count === 0) {
    elements.batchPreview.textContent = '';
    return;
  }

  const batchCount = Math.ceil(count / state.batchSize);
  elements.batchPreview.textContent = `${batchCount} ${pluralize('batch', batchCount)} of ${state.batchSize}`;
}

/**
 * Updates the last sync timestamp display
 */
function updateLastSync() {
  if (!state.lastSync) {
    elements.lastSync.textContent = '';
    return;
  }
  elements.lastSync.textContent = `Last updated: ${formatRelativeTime(state.lastSync)}`;
}

// =============================================================================
// Stats Section
// =============================================================================

/**
 * Renders the stats section from a click log array
 * @param {Array} log - Array of click log entries
 */
function renderStats(log) {
  if (log.length === 0) {
    elements.statsSummary.textContent = '';
    elements.statsTop10.innerHTML = '<div class="stats-empty">No clicks logged yet — open some articles first.</div>';
    return;
  }

  // Summary line
  const timestamps = log.map(e => e.timestamp).filter(Boolean);
  const oldest = timestamps.length ? new Date(Math.min(...timestamps)).toLocaleDateString() : '—';
  const newest = timestamps.length ? new Date(Math.max(...timestamps)).toLocaleDateString() : '—';
  elements.statsSummary.textContent = `${log.length} clicks  ·  ${oldest} – ${newest}`;

  // Aggregate by feedTitle (fallback to hostname)
  const counts = {};
  for (const entry of log) {
    let key = entry.feedTitle;
    if (!key && entry.url) {
      try {
        key = new URL(entry.url).hostname.replace(/^www\./, '');
      } catch (_) {
        key = entry.url;
      }
    }
    if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  const top10 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const rows = top10.map(([source, count], i) => `
    <tr>
      <td>${i + 1}</td>
      <td title="${escapeHtml(source)}">${escapeHtml(source)}</td>
      <td>${count}</td>
    </tr>
  `).join('');

  elements.statsTop10.innerHTML = `
    <table class="stats-table">
      <thead><tr><th>#</th><th>Source</th><th>Opens</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/**
 * Loads the click log from storage and renders the stats section
 */
async function loadStats() {
  try {
    const response = await browser.runtime.sendMessage({ action: 'getClickLog' });
    if (response.error) {
      throw new Error(response.error);
    }
    renderStats(response.log || []);
  } catch (error) {
    console.error('Failed to load stats:', error);
    elements.statsTop10.innerHTML = '<div class="stats-empty">Failed to load stats.</div>';
  }
}

/**
 * Toggles the stats section visibility
 */
async function toggleStats() {
  state.statsVisible = !state.statsVisible;
  if (state.statsVisible) {
    elements.statsSection.classList.remove('hidden');
    elements.toggleStatsBtn.textContent = '📊 Hide Stats';
    await loadStats();
  } else {
    elements.statsSection.classList.add('hidden');
    elements.toggleStatsBtn.textContent = '📊 Stats';
  }
}

/**
 * Clears the click log after confirmation
 */
async function clearLog() {
  const confirmed = await showConfirmModal('Clear all click history? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({ action: 'clearClickLog' });
    if (response.error) {
      throw new Error(response.error);
    }
    renderStats([]);
    showToast('Click log cleared', 'success');
  } catch (error) {
    console.error('Failed to clear log:', error);
    showToast('Failed to clear log', 'error');
  }
}

// =============================================================================
// Export Functionality
// =============================================================================

/**
 * Exports article URLs to a text file
 */
function exportArticles() {
  if (state.articles.length === 0) {
    showToast('No articles to export', 'error');
    return;
  }

  const urls = state.articles
    .map(article => getArticleUrl(article))
    .filter(url => url)
    .join('\n');

  const blob = new Blob([urls], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `feedly-saved-${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Exported ${state.articles.length} URLs`, 'success');
}

/**
 * Exports the click log as a JSON file for use with feedly-auditor --top10
 */
async function exportClickLog() {
  try {
    const response = await browser.runtime.sendMessage({ action: 'getClickLog' });

    if (response.error) {
      throw new Error(response.error);
    }

    const log = response.log || [];
    if (log.length === 0) {
      showToast('No click history yet — open some articles first', 'info');
      return;
    }

    const json = JSON.stringify(log, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'feedly-click-log.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${log.length} click${log.length === 1 ? '' : 's'}`, 'success');
  } catch (error) {
    console.error('Failed to export click log:', error);
    showToast('Failed to export click log', 'error');
  }
}

// =============================================================================
// UI Management
// =============================================================================

/**
 * Shows a specific view and hides all others
 * @param {'loading'|'notAuth'|'auth'|'error'|'content'|'empty'} viewName - Name of view to show
 */
function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  if (views[viewName]) {
    views[viewName].classList.remove('hidden');
  }
}

/**
 * Pluralizes a word based on count
 * @param {string} word - Word to pluralize
 * @param {number} count - Count to check
 * @returns {string} Pluralized word
 */
function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

/**
 * Updates the UI based on current application state
 */
function updateUI() {
  const count = state.articles.length;

  if (count === 0) {
    views.content.classList.add('hidden');
    views.empty.classList.remove('hidden');
    elements.progressText.textContent = '';
    elements.exportBtn.classList.add('hidden');
    renderArticleList();
    updateBatchPreview();
    updateLastSync();
    return;
  }

  views.content.classList.remove('hidden');
  views.empty.classList.add('hidden');

  elements.articleCount.textContent = `${count} Saved ${pluralize('Article', count)}`;

  const openCount = Math.min(state.batchSize, count);
  elements.openBatchBtn.textContent = `⚡ Open ${openCount} ${pluralize('Article', openCount)}`;

  const batchCount = Math.ceil(count / state.batchSize);
  elements.openAllBtn.textContent = `Open All (${batchCount} ${pluralize('batch', batchCount)})`;
  elements.openAllBtn.classList.remove('hidden');

  elements.exportBtn.classList.remove('hidden');

  renderArticleList();
  updateBatchPreview();
  updateLastSync();
}

/**
 * Sets loading state for buttons
 * @param {boolean} active - Whether loading is active
 * @param {HTMLButtonElement|null} btn - Specific button to update
 */
function setLoading(active, btn = null) {
  state.processing = active;

  if (btn) {
    if (active) {
      btn.dataset.original = btn.textContent;
      btn.classList.add('btn-loading');
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.original || btn.textContent;
      btn.classList.remove('btn-loading');
      btn.disabled = false;
      delete btn.dataset.original;
    }
  }

  elements.refreshBtn.disabled = active;
  elements.openAllBtn.disabled = active;
  elements.openBatchBtn.disabled = active;
}

// =============================================================================
// Authentication
// =============================================================================

/**
 * Checks authentication status and loads articles if authenticated
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
 * Saves authentication token and validates it
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
 * Logs out and clears authentication
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

// =============================================================================
// Article Management
// =============================================================================

/**
 * Loads articles from Feedly via background script
 */
async function loadArticles(forceRefresh = false) {
  elements.articleCount.textContent = 'Loading...';

  try {
    const response = await browser.runtime.sendMessage({
      action: 'getArticles',
      forceRefresh
    });

    if (response.error) {
      const err = new Error(response.error);
      err.errorType = response.errorType;
      throw err;
    }

    state.articles = Array.isArray(response.articles) ? response.articles : [];
    state.lastSync = response.lastSync || Date.now();

    if (response.fromCache) {
      showToast('Showing cached data', 'info', 2000);
    }

    updateUI();

  } catch (error) {
    console.error('Failed to load articles:', error);
    const errorType = error.errorType || '';

    if (errorType === 'AUTH_EXPIRED') {
      await logout();
      showError('Session expired. Please reconnect.', true);
    } else if (errorType === 'NETWORK') {
      elements.articleCount.textContent = 'Offline';
      showError('Network error. Check your connection and try again.');
    } else if (errorType === 'RATE_LIMITED') {
      elements.articleCount.textContent = 'Rate limited';
      showError('Too many requests. Please wait a moment.');
    } else {
      elements.articleCount.textContent = 'Error loading';
      showError('Failed to load articles. Try refreshing.');
    }
  }
}

/**
 * Opens a batch of articles
 * @param {Array|null} articlesToProcess - Specific articles to process, or null for default batch
 * @returns {Promise<number>} Number of articles opened
 */
async function openBatch(articlesToProcess = null) {
  if (state.processing && !articlesToProcess) {
    return 0;
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

  elements.progressText.textContent = `Opening ${targetArticles.length} ${pluralize('tab', targetArticles.length)}...`;

  try {
    const response = await browser.runtime.sendMessage({
      action: 'openBatch',
      articles: targetArticles
    });

    if (response.error) {
      throw new Error(response.error);
    }

    const openedCount = response.opened || 0;
    const unstarFailed = response.unstarFailed || 0;

    // Refresh from API for accurate state
    if (!articlesToProcess) {
      await loadArticles(true);
    }

    elements.progressText.textContent = `Opened ${openedCount} ${pluralize('article', openedCount)}`;

    if (unstarFailed > 0) {
      showToast(`${unstarFailed} ${pluralize('article', unstarFailed)} failed to unsave`, 'error');
    }

    setTimeout(() => {
      if (!state.processing) {
        elements.progressText.textContent = '';
      }
    }, PROGRESS_CLEAR_DELAY_MS);

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
 * Opens all articles in controlled batches with cooldown periods
 */
async function openAllSmart() {
  if (state.processing || state.articles.length === 0) {
    return;
  }

  const totalCount = state.articles.length;
  const batchCount = Math.ceil(totalCount / state.batchSize);

  const confirmed = await showConfirmModal(
    `This will open all ${totalCount} ${pluralize('article', totalCount)} in ${batchCount} ${pluralize('batch', batchCount)} of ${state.batchSize}.`
  );

  if (!confirmed) {
    return;
  }

  setLoading(true, elements.openAllBtn);

  let totalOpened = 0;
  let currentBatch = 0;

  try {
    updateProgress(0, totalCount);

    while (state.articles.length > 0) {
      currentBatch++;
      const batchSize = Math.min(state.batchSize, state.articles.length);
      const batch = state.articles.slice(0, batchSize);

      elements.progressText.textContent = `Processing batch ${currentBatch} of ${batchCount}...`;

      const opened = await openBatch(batch);
      totalOpened += opened;

      // openBatch with articlesToProcess doesn't refresh, so update locally
      state.articles = state.articles.slice(batchSize);
      updateProgress(totalOpened, totalCount);
      updateUI();

      if (state.articles.length > 0) {
        elements.progressText.textContent = 'Cooling down...';
        await wait(BATCH_COOLDOWN_MS);
      }
    }

    hideProgress();
    elements.progressText.textContent = `Completed! Opened ${totalOpened} ${pluralize('article', totalOpened)}.`;
    showToast(`Opened ${totalOpened} articles`, 'success');

    // Close popup after successful completion
    setTimeout(() => window.close(), COMPLETION_CLOSE_DELAY_MS);

  } catch (error) {
    console.error('Smart batch error:', error);
    hideProgress();
    showError('Batch processing failed: ' + error.message);
  } finally {
    setLoading(false, elements.openAllBtn);
    const count = state.articles.length;
    const newBatchCount = Math.ceil(count / state.batchSize);
    elements.openAllBtn.textContent = `Open All (${newBatchCount} ${pluralize('batch', newBatchCount)})`;
  }
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Displays an error message to the user
 * @param {string} msg - Error message to display
 * @param {boolean} isFatal - If true, shows error view; otherwise shows alert
 */
function showError(msg, isFatal = false) {
  elements.errorMsg.textContent = msg;

  if (isFatal) {
    showView('error');
  } else {
    // Show as toast for non-fatal errors
    showToast(msg, 'error');
  }
}

// =============================================================================
// Event Listeners
// =============================================================================

// Debounced settings save to prevent excessive storage writes
const debouncedSaveSettings = debounce(saveSettings, SETTINGS_DEBOUNCE_MS);

/**
 * Sets up all event listeners for the popup
 */
function setupEventListeners() {
  elements.batchSize.addEventListener('input', () => {
    debouncedSaveSettings();
    updateBatchPreview();
  });
  elements.batchSize.addEventListener('blur', saveSettings);

  elements.openBatchBtn.addEventListener('click', () => openBatch());
  elements.openAllBtn.addEventListener('click', openAllSmart);
  elements.refreshBtn.addEventListener('click', () => loadArticles(true));

  elements.toggleListBtn.addEventListener('click', toggleArticleList);
  elements.exportBtn.addEventListener('click', exportArticles);
  elements.exportLogBtn.addEventListener('click', exportClickLog);
  elements.toggleStatsBtn.addEventListener('click', toggleStats);
  elements.clearLogBtn.addEventListener('click', clearLog);

  elements.toggleTokenVisibility.addEventListener('click', () => {
    const isPassword = elements.tokenInput.type === 'password';
    elements.tokenInput.type = isPassword ? 'text' : 'password';
    elements.eyeIcon.textContent = isPassword ? '🙈' : '👁️';
  });

  elements.saveTokenBtn.addEventListener('click', saveToken);
  elements.tokenInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveToken();
    }
  });

  elements.logoutBtn.addEventListener('click', async () => {
    const confirmed = await showConfirmModal('Disconnect your Feedly account?');
    if (confirmed) {
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

  document.addEventListener('keypress', (e) => {
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      if (!state.processing) {
        loadArticles(true);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.confirmModal.classList.contains('hidden')) {
      elements.modalCancel.click();
    }
  });
}

// =============================================================================
// Entry Point
// =============================================================================

init();
