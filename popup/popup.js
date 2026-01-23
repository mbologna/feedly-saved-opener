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

// State
let state = {
    articles: [],
    batchSize: 30,
    processing: false
};

const STORAGE_KEY = 'userSettings';

// --- Initialization & Settings ---

async function init() {
    await loadSettings();
    checkAuthAndLoad();
}

async function loadSettings() {
    const result = await browser.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
        state.batchSize = result[STORAGE_KEY].batchSize || 30;
    }
    elements.batchSize.value = state.batchSize;
}

async function saveSettings() {
    let val = parseInt(elements.batchSize.value);
    if (val < 1) val = 1;
    if (val > 100) val = 100; // Cap at 100 for browser safety

    state.batchSize = val;
    elements.batchSize.value = val;

    await browser.storage.local.set({
        [STORAGE_KEY]: { batchSize: state.batchSize }
    });
    updateUI(); // Refresh button text
}

// --- View Management ---

function showView(viewName) {
    // Hide all main views
    ['loading', 'notAuth', 'auth', 'error'].forEach(v => {
        views[v].classList.add('hidden');
    });
    // Show target
    views[viewName].classList.remove('hidden');
}

function updateUI() {
    const count = state.articles.length;

    // 1. Check if empty
    if (count === 0) {
        views.content.classList.add('hidden');
        views.empty.classList.remove('hidden');
        elements.progressText.textContent = '';
        return;
    }

    // 2. Show content
    views.content.classList.remove('hidden');
    views.empty.classList.add('hidden');

    // 3. Update Text & Button
    elements.articleCount.textContent = `${count} Saved Article${count !== 1 ? 's' : ''}`;

    const openCount = Math.min(state.batchSize, count);
    elements.openBatchBtn.textContent = `⚡ Open ${openCount} Article${openCount !== 1 ? 's' : ''}`;
    elements.openBatchBtn.disabled = false;
}

function setLoading(active, btn = null) {
    state.processing = active;
    if (btn) {
        if (active) {
            btn.dataset.original = btn.textContent;
            btn.textContent = 'Wait...';
            btn.disabled = true;
        } else {
            btn.textContent = btn.dataset.original || btn.textContent;
            btn.disabled = false;
        }
    }
    // Also disable/enable global interactions
    elements.refreshBtn.disabled = active;
}

// --- Core Logic ---

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
    } catch (e) {
        showError('Could not connect to extension background.', true);
    }
}

async function loadArticles() {
    elements.articleCount.textContent = 'Loading...';
    setLoading(true, elements.refreshBtn);

    try {
        const response = await browser.runtime.sendMessage({ action: 'getArticles' });
        if (response.error) throw new Error(response.error);

        state.articles = response.articles || [];
        updateUI();
    } catch (error) {
        console.error(error);
        elements.articleCount.textContent = 'Error';
        // Don't fully crash, just show alert/toast logic ideally, but here we might fallback
        if (error.message.includes('401')) {
            logout(); // Auto logout on auth error
        }
    } finally {
        setLoading(false, elements.refreshBtn);
    }
}

async function openBatch() {
    if (state.processing || state.articles.length === 0) return;

    const batchSize = Math.min(state.batchSize, state.articles.length);
    const articlesToOpen = state.articles.slice(0, batchSize);

    setLoading(true, elements.openBatchBtn);
    elements.progressText.textContent = `Opening ${batchSize} tabs...`;

    try {
        const response = await browser.runtime.sendMessage({
            action: 'openBatch',
            articles: articlesToOpen
        });

        if (response.error) throw new Error(response.error);

        // Update local state immediately
        const openedCount = response.opened;
        state.articles = state.articles.slice(openedCount);

        updateUI();

        elements.progressText.textContent = `Opened ${openedCount} articles.`;
        setTimeout(() => { elements.progressText.textContent = ''; }, 3000);

        // If all done, close popup shortly after
        if (state.articles.length === 0) {
            setTimeout(() => window.close(), 1500);
        }

    } catch (error) {
        showError('Failed to open articles: ' + error.message);
    } finally {
        setLoading(false, elements.openBatchBtn);
    }
}

async function saveToken() {
    const token = elements.tokenInput.value.trim();
    if (!token) return;

    setLoading(true, elements.saveTokenBtn);
    try {
        await browser.runtime.sendMessage({ action: 'saveToken', token });
        elements.tokenInput.value = '';
        checkAuthAndLoad();
    } catch (e) {
        showError('Failed to save token');
    } finally {
        setLoading(false, elements.saveTokenBtn);
    }
}

async function logout() {
    if (!confirm('Disconnect your Feedly account?')) return;
    await browser.runtime.sendMessage({ action: 'logout' });
    showView('notAuth');
}

function showError(msg, isFatal = false) {
    elements.errorMsg.textContent = msg;
    if (isFatal) showView('error');
    else alert(msg);
}

// --- Event Listeners ---

elements.batchSize.addEventListener('change', saveSettings);
elements.openBatchBtn.addEventListener('click', openBatch);
elements.refreshBtn.addEventListener('click', loadArticles);
elements.saveTokenBtn.addEventListener('click', saveToken);
elements.logoutBtn.addEventListener('click', logout);
elements.resetAuthBtn.addEventListener('click', logout);
elements.retryBtn.addEventListener('click', checkAuthAndLoad);
elements.openFeedlyBtn.addEventListener('click', () => browser.tabs.create({ url: 'https://feedly.com/i/console' }));
elements.goToFeedlyBtn.addEventListener('click', () => browser.tabs.create({ url: 'https://feedly.com/i/saved' }));

// Init
init();
