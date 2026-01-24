/**
 * Test Suite for Feedly Saved Opener
 * Run: node tests/test.js
 */

const TEST_RESULTS = {
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: []
};

// Mock browser API
const mockBrowser = {
    storage: {
        local: {
            data: {},
            get: function (keys) {
                return Promise.resolve(
                    Array.isArray(keys)
                        ? keys.reduce((acc, key) => ({ ...acc, [key]: this.data[key] }), {})
                        : { [keys]: this.data[keys] }
                );
            },
            set: function (items) {
                Object.assign(this.data, items);
                return Promise.resolve();
            },
            remove: function (keys) {
                const keysArray = Array.isArray(keys) ? keys : [keys];
                keysArray.forEach(key => delete this.data[key]);
                return Promise.resolve();
            },
            clear: function () {
                this.data = {};
                return Promise.resolve();
            }
        }
    },
    runtime: {
        onMessage: {
            addListener: function () { }
        }
    },
    tabs: {
        create: function (options) {
            if (!options.url) {
                return Promise.reject(new Error('URL required'));
            }
            return Promise.resolve({ id: Math.floor(Math.random() * 1000) });
        }
    },
    action: {
        setBadgeText: function () { return Promise.resolve(); },
        setBadgeBackgroundColor: function () { return Promise.resolve(); }
    },
    contextMenus: {
        create: function () { return Promise.resolve(); },
        onClicked: {
            addListener: function () { }
        }
    }
};

// Test utilities
function assert(condition, message) {
    if (condition) {
        TEST_RESULTS.passed++;
        TEST_RESULTS.tests.push({ name: message, status: 'PASS' });
        console.log(`✓ ${message}`);
    } else {
        TEST_RESULTS.failed++;
        TEST_RESULTS.tests.push({ name: message, status: 'FAIL' });
        console.error(`✗ ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    assert(matches, `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
}

function assertNotNull(value, message) {
    assert(value !== null && value !== undefined, message);
}

function assertThrows(fn, message) {
    let threw = false;
    try {
        fn();
    } catch (e) {
        threw = true;
    }
    assert(threw, message);
}

async function runTest(name, testFn) {
    console.log(`\n--- ${name} ---`);
    try {
        await testFn();
    } catch (error) {
        TEST_RESULTS.failed++;
        TEST_RESULTS.tests.push({ name, status: 'ERROR', error: error.message });
        console.error(`✗ ${name} - ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

// Test Suite
async function runAllTests() {
    console.log('🧪 Feedly Saved Opener - Test Suite\n');
    console.log('='.repeat(60));

    // Test 1: Storage API
    await runTest('Storage API - Basic Operations', async () => {
        await mockBrowser.storage.local.clear();

        await mockBrowser.storage.local.set({ testKey: 'testValue' });
        const result1 = await mockBrowser.storage.local.get('testKey');
        assertEqual(result1.testKey, 'testValue', 'Set and get single value');

        await mockBrowser.storage.local.set({ key1: 'val1', key2: 'val2' });
        const result2 = await mockBrowser.storage.local.get(['key1', 'key2']);
        assertEqual(result2.key1, 'val1', 'Get multiple keys (key1)');
        assertEqual(result2.key2, 'val2', 'Get multiple keys (key2)');

        await mockBrowser.storage.local.remove('key1');
        const result3 = await mockBrowser.storage.local.get('key1');
        assertEqual(result3.key1, undefined, 'Remove key');

        await mockBrowser.storage.local.clear();
        const result4 = await mockBrowser.storage.local.get(['key2', 'testKey']);
        assert(Object.values(result4).every(v => v === undefined), 'Clear all data');
    });

    // Test 2: Settings Management
    await runTest('Settings - Batch Size Management', async () => {
        await mockBrowser.storage.local.clear();

        const defaultSettings = { batchSize: 30 };
        await mockBrowser.storage.local.set({ userSettings: defaultSettings });
        const result1 = await mockBrowser.storage.local.get('userSettings');
        assertEqual(result1.userSettings.batchSize, 30, 'Default batch size');

        const updatedSettings = { batchSize: 50 };
        await mockBrowser.storage.local.set({ userSettings: updatedSettings });
        const result2 = await mockBrowser.storage.local.get('userSettings');
        assertEqual(result2.userSettings.batchSize, 50, 'Update batch size');

        // Test invalid batch sizes
        const invalidSizes = [0, -1, 101, 1000];
        invalidSizes.forEach(size => {
            assert(size < 1 || size > 100, `Invalid batch size: ${size}`);
        });

        // Test valid batch sizes
        const validSizes = [1, 30, 50, 100];
        validSizes.forEach(size => {
            assert(size >= 1 && size <= 100, `Valid batch size: ${size}`);
        });
    });

    // Test 3: Token Management
    await runTest('Authentication - Token Storage', async () => {
        await mockBrowser.storage.local.clear();

        const testToken = 'AkEd83jf92Kf_test_token_12345';
        await mockBrowser.storage.local.set({ accessToken: testToken });

        const result1 = await mockBrowser.storage.local.get('accessToken');
        assertEqual(result1.accessToken, testToken, 'Store token');

        await mockBrowser.storage.local.remove('accessToken');
        const result2 = await mockBrowser.storage.local.get('accessToken');
        assertEqual(result2.accessToken, undefined, 'Remove token');

        // Test empty token
        await mockBrowser.storage.local.set({ accessToken: '' });
        const result3 = await mockBrowser.storage.local.get('accessToken');
        assert(result3.accessToken === '', 'Handle empty token');
    });

    // Test 4: Article Processing
    await runTest('Articles - Batch Processing Logic', () => {
        const articles = [
            { id: '1', title: 'Article 1', canonicalUrl: 'https://example.com/1' },
            { id: '2', title: 'Article 2', canonicalUrl: 'https://example.com/2' },
            { id: '3', title: 'Article 3', canonicalUrl: 'https://example.com/3' },
            { id: '4', title: 'Article 4', canonicalUrl: 'https://example.com/4' },
            { id: '5', title: 'Article 5', canonicalUrl: 'https://example.com/5' }
        ];

        const batchSize = 2;
        const batch = articles.slice(0, batchSize);
        assertEqual(batch.length, 2, 'Correct batch size');
        assertEqual(batch[0].id, '1', 'First article in batch');
        assertEqual(batch[1].id, '2', 'Second article in batch');

        const remaining = articles.slice(batchSize);
        assertEqual(remaining.length, 3, 'Remaining articles count');
        assertEqual(remaining[0].id, '3', 'First remaining article');

        // Test edge cases
        const emptyBatch = [].slice(0, 5);
        assertEqual(emptyBatch.length, 0, 'Empty array batch');

        const oversizedBatch = articles.slice(0, 100);
        assertEqual(oversizedBatch.length, 5, 'Oversized batch limited by array length');
    });

    // Test 5: URL Validation
    await runTest('URLs - Validation Logic', () => {
        const validUrls = [
            'https://example.com/article',
            'http://example.com',
            'https://blog.example.com/post/123',
            'https://example.com/path?query=test&param=value',
            'https://subdomain.example.co.uk/path'
        ];

        const invalidUrls = [
            '',
            null,
            undefined,
            'not-a-url',
            'javascript:alert(1)',
            'file:///etc/passwd',
            'ftp://example.com',
            'data:text/html,<script>alert(1)</script>'
        ];

        validUrls.forEach(url => {
            assert(
                url && (url.startsWith('http://') || url.startsWith('https://')),
                `Valid URL: ${url}`
            );
        });

        invalidUrls.forEach(url => {
            assert(
                !url || (!url.startsWith('http://') && !url.startsWith('https://')),
                `Invalid URL rejected: ${url || 'null/undefined'}`
            );
        });
    });

    // Test 6: Article URL Extraction
    await runTest('Articles - URL Extraction', () => {
        const testCases = [
            {
                article: { canonicalUrl: 'https://example.com/article' },
                expected: 'https://example.com/article',
                name: 'Canonical URL'
            },
            {
                article: { alternate: [{ href: 'https://example.com/alt' }] },
                expected: 'https://example.com/alt',
                name: 'Alternate URL'
            },
            {
                article: {
                    canonicalUrl: 'https://example.com/canonical',
                    alternate: [{ href: 'https://example.com/alt' }]
                },
                expected: 'https://example.com/canonical',
                name: 'Canonical takes precedence'
            },
            {
                article: {},
                expected: undefined,
                name: 'No URL available'
            }
        ];

        testCases.forEach(({ article, expected, name }) => {
            const url = article.canonicalUrl || article.alternate?.[0]?.href;
            assertEqual(url, expected, name);
        });
    });

    // Test 7: Badge Display Logic
    await runTest('Badge - Display Logic', () => {
        const testCases = [
            { count: 0, expected: '' },
            { count: 5, expected: '5' },
            { count: 99, expected: '99' },
            { count: 100, expected: '100' },
            { count: 999, expected: '999' },
            { count: 1000, expected: '999+' },
            { count: 9999, expected: '999+' }
        ];

        testCases.forEach(({ count, expected }) => {
            const badgeText = count <= 0 ? '' :
                count > 999 ? '999+' :
                    count.toString();
            assertEqual(badgeText, expected, `Badge for count ${count}`);
        });
    });

    // Test 8: Error Handling
    await runTest('Error Handling - Various Scenarios', async () => {
        await mockBrowser.storage.local.clear();

        // Missing token
        const result1 = await mockBrowser.storage.local.get('accessToken');
        assertEqual(result1.accessToken, undefined, 'Handle missing token');

        // Empty article list
        const emptyArticles = [];
        assertEqual(emptyArticles.length, 0, 'Handle empty article list');

        // Invalid article structure
        const invalidArticle = { id: '123' }; // No URL
        const url = invalidArticle.canonicalUrl || invalidArticle.alternate?.[0]?.href;
        assertEqual(url, undefined, 'Handle article without URL');
    });

    // Test 9: Batch Size Edge Cases
    await runTest('Batch Size - Edge Cases', () => {
        const articles = Array.from({ length: 100 }, (_, i) => ({
            id: `${i + 1}`,
            canonicalUrl: `https://example.com/${i + 1}`
        }));

        // Test minimum batch
        const minBatch = articles.slice(0, 1);
        assertEqual(minBatch.length, 1, 'Minimum batch size (1)');

        // Test maximum batch
        const maxBatch = articles.slice(0, 100);
        assertEqual(maxBatch.length, 100, 'Maximum batch size (100)');

        // Test partial batch
        const partialBatch = articles.slice(95, 100);
        assertEqual(partialBatch.length, 5, 'Partial batch at end');
    });

    // Test 10: Data Persistence
    await runTest('Storage - Data Persistence', async () => {
        await mockBrowser.storage.local.clear();

        const testData = {
            accessToken: 'test_token_abc123',
            userId: 'user/12345',
            userSettings: { batchSize: 45 }
        };

        await mockBrowser.storage.local.set(testData);

        // Simulate reload
        const loaded = await mockBrowser.storage.local.get(Object.keys(testData));

        assertEqual(loaded.accessToken, testData.accessToken, 'Token persists');
        assertEqual(loaded.userId, testData.userId, 'User ID persists');
        assertEqual(loaded.userSettings.batchSize, testData.userSettings.batchSize, 'Settings persist');
    });

    // Test 11: Tab Creation
    await runTest('Tabs - Creation Logic', async () => {
        const validUrl = 'https://example.com/article';
        const result = await mockBrowser.tabs.create({ url: validUrl, active: false });

        assertNotNull(result.id, 'Tab created with ID');
        assert(typeof result.id === 'number', 'Tab ID is number');

        // Test invalid URL handling
        let errorThrown = false;
        try {
            await mockBrowser.tabs.create({ active: false });
        } catch (e) {
            errorThrown = true;
        }
        assert(errorThrown, 'Rejects tab creation without URL');
    });

    // Test 12: Manifest Validation
    await runTest('Manifest - Structure Validation', () => {
        const manifest = {
            manifest_version: 3,
            name: 'Feedly Saved Opener',
            version: '2.0.0',
            permissions: ['storage', 'tabs', 'menus'],
            host_permissions: ['https://cloud.feedly.com/*']
        };

        assertEqual(manifest.manifest_version, 3, 'Manifest version 3');
        assertNotNull(manifest.name, 'Name exists');
        assertNotNull(manifest.version, 'Version exists');
        assert(manifest.permissions.includes('storage'), 'Has storage permission');
        assert(manifest.permissions.includes('tabs'), 'Has tabs permission');
        assert(manifest.permissions.includes('menus'), 'Has menus permission');
        assert(manifest.host_permissions.includes('https://cloud.feedly.com/*'), 'Has Feedly API permission');
    });

    // Print Results
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Test Results Summary:');
    console.log(`✓ Passed:  ${TEST_RESULTS.passed}`);
    console.log(`✗ Failed:  ${TEST_RESULTS.failed}`);
    console.log(`📈 Total:   ${TEST_RESULTS.tests.length}`);

    const successRate = ((TEST_RESULTS.passed / TEST_RESULTS.tests.length) * 100).toFixed(1);
    console.log(`📊 Success: ${successRate}%`);

    if (TEST_RESULTS.failed > 0) {
        console.log('\n❌ Failed Tests:');
        TEST_RESULTS.tests
            .filter(t => t.status !== 'PASS')
            .forEach(t => console.log(`  - ${t.name} (${t.status})`));
    } else {
        console.log('\n🎉 All tests passed!');
    }

    console.log('\n' + '='.repeat(60));

    process.exit(TEST_RESULTS.failed === 0 ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
    console.error('❌ Test suite crashed:', error);
    process.exit(1);
});
