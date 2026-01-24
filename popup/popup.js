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

let state = {
    articles: [],
    batchSize: 30,
    processing: false
};

const STORAGE_KEY = 'userSettings';

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
    if (val > 100) val = 100;
    state.batchSize = val;
    elements.batchSize.value = val;
    await browser.storage.local.set({ [STORAGE_KEY]: { batchSize: state.batchSize } });
    updateUI();
}

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

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

    // Toggle Open All button visibility based on count
    if (count > state.batchSize) {
        elements.openAllBtn.classList.remove('hidden');
    } else {
        elements.openAllBtn.classList.add('hidden');
    }
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
    elements.refreshBtn.disabled = active;
    elements.openAllBtn.disabled = active;
    elements.openBatchBtn.disabled = active;
}

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
    elements.articleCount.textContent = '...';
    // Don't full block UI, just update text
    try {
        const response = await browser.runtime.sendMessage({ action: 'getArticles' });
        if (response.error) throw new Error(response.error);
        state.articles = response.articles || [];
        updateUI();
    } catch (error) {
        if (error.message.includes('401')) logout();
        else console.error(error);
    }
}

async function openBatch(articlesToProcess = null) {
    if (state.processing && !articlesToProcess) return;

    const batchSize = Math.min(state.batchSize, state.articles.length);
    const targetArticles = articlesToProcess || state.articles.slice(0, batchSize);

    if (!articlesToProcess) setLoading(true, elements.openBatchBtn);
    elements.progressText.textContent = `Opening ${targetArticles.length} tabs...`;

    try {
        const response = await browser.runtime.sendMessage({
            action: 'openBatch',
            articles: targetArticles
        });

        if (response.error) throw new Error(response.error);

        // Remove opened from local state
        const openedCount = response.opened;
        // Ideally we filter out by ID, but for speed we slice logic
        // This assumes the API processed them in order
        if (!articlesToProcess) {
            state.articles = state.articles.slice(openedCount);
            updateUI();
        }

        elements.progressText.textContent = `Opened ${openedCount} articles.`;
        return openedCount;

    } catch (error) {
        showError('Failed: ' + error.message);
        return 0;
    } finally {
        if (!articlesToProcess) setLoading(false, elements.openBatchBtn);
    }
}

// "Wit & Polish": Smart Batching Loop
async function openAllSmart() {
    if (state.processing || state.articles.length === 0) return;

    if (!confirm(`This will open all ${state.articles.length} articles in batches of ${state.batchSize}.\nContinue?`)) return;

    setLoading(true, elements.openAllBtn);
    elements.openAllBtn.textContent = 'Processing All...';

    try {
        while (state.articles.length > 0) {
            const batchSize = Math.min(state.batchSize, state.articles.length);
            const batch = state.articles.slice(0, batchSize);

            elements.progressText.textContent = `Batching ${batchSize} items (${state.articles.length} remaining)...`;

            await openBatch(batch);

            // Remove from local state explicitly
            state.articles = state.articles.slice(batchSize);
            updateUI();

            // Safety pause between batches
            if (state.articles.length > 0) {
                elements.progressText.textContent = "Cooling down (1s)...";
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        // Done
        setTimeout(() => window.close(), 1000);
    } catch (e) {
        showError(e.message);
    } finally {
        setLoading(false, elements.openAllBtn);
        elements.openAllBtn.textContent = 'Open All (Smart Batch)';
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
    } catch (e) { showError('Failed to save token'); }
    finally { setLoading(false, elements.saveTokenBtn); }
}

async function logout() {
    await browser.runtime.sendMessage({ action: 'logout' });
    showView('notAuth');
}

function showError(msg, isFatal = false) {
    elements.errorMsg.textContent = msg;
    if (isFatal) showView('error'); else alert(msg);
}

// Listeners
elements.batchSize.addEventListener('change', saveSettings);
elements.openBatchBtn.addEventListener('click', () => openBatch());
elements.openAllBtn.addEventListener('click', openAllSmart);
elements.refreshBtn.addEventListener('click', loadArticles);
elements.saveTokenBtn.addEventListener('click', saveToken);
elements.logoutBtn.addEventListener('click', () => { if (confirm('Disconnect?')) logout(); });
elements.resetAuthBtn.addEventListener('click', logout);
elements.retryBtn.addEventListener('click', checkAuthAndLoad);
elements.openFeedlyBtn.addEventListener('click', () => browser.tabs.create({ url: 'https://feedly.com/i/console' }));
elements.goToFeedlyBtn.addEventListener('click', () => browser.tabs.create({ url: 'https://feedly.com/i/saved' }));

init();
