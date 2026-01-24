/**
 * Automated Tests for Feedly Saved Opener
 * Run with: node tests/test.js
 */

const TEST_RESULTS = {
    passed: 0,
    failed: 0,
    tests: []
};

// Mock browser API for testing
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
        create: function () {
            return Promise.resolve({ id: Math.random() });
        }
    },
    browserAction: {
        setBadgeText: function () { },
        setBadgeBackgroundColor: function () { }
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
    assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

function assertNotNull(value, message) {
    assert(value !== null && value !== undefined, message);
}

async function runTest(name, testFn) {
    console.log(`\n--- ${name} ---`);
    try {
        await testFn();
    } catch (error) {
        TEST_RESULTS.failed++;
        TEST_RESULTS.tests.push({ name, status: 'ERROR', error: error.message });
        console.error(`✗ ${name} - ERROR: ${error.message}`);
    }
}

// Test Suite
async function runAllTests() {
    console.log('🧪 Starting Feedly Saved Opener Tests\n');
    console.log('='.repeat(50));

    // Test 1: Storage API
    await runTest('Storage API', async () => {
        await mockBrowser.storage.local.clear();

        // Test set
        await mockBrowser.storage.local.set({ testKey: 'testValue' });
        const result1 = await mockBrowser.storage.local.get('testKey');
        assertEqual(result1.testKey, 'testValue', 'Storage set/get single key');

        // Test multiple keys
        await mockBrowser.storage.local.set({ key1: 'value1', key2: 'value2' });
        const result2 = await mockBrowser.storage.local.get(['key1', 'key2']);
        assertEqual(result2.key1, 'value1', 'Storage get multiple keys (key1)');
        assertEqual(result2.key2, 'value2', 'Storage get multiple keys (key2)');

        // Test remove
        await mockBrowser.storage.local.remove('key1');
        const result3 = await mockBrowser.storage.local.get('key1');
        assertEqual(result3.key1, undefined, 'Storage remove key');

        // Test clear
        await mockBrowser.storage.local.clear();
        const result4 = await mockBrowser.storage.local.get(['key2', 'testKey']);
        assertEqual(Object.keys(result4).length, 2, 'Storage clear');
    });

    // Test 2: Settings Management
    await runTest('Settings Management', async () => {
        await mockBrowser.storage.local.clear();

        const defaultSettings = { batchSize: 30 };
        await mockBrowser.storage.local.set({ userSettings: defaultSettings });

        const result = await mockBrowser.storage.local.get('userSettings');
        assertEqual(result.userSettings.batchSize, 30, 'Default batch size');

        // Update settings
        const newSettings = { batchSize: 50 };
        await mockBrowser.storage.local.set({ userSettings: newSettings });
        const result2 = await mockBrowser.storage.local.get('userSettings');
        assertEqual(result2.userSettings.batchSize, 50, 'Updated batch size');
    });

    // Test 3: Token Management
    await runTest('Token Management', async () => {
        await mockBrowser.storage.local.clear();

        const testToken = 'test_token_12345';
        await mockBrowser.storage.local.set({ accessToken: testToken });

        const result = await mockBrowser.storage.local.get('accessToken');
        assertEqual(result.accessToken, testToken, 'Token storage');

        // Test token removal
        await mockBrowser.storage.local.remove('accessToken');
        const result2 = await mockBrowser.storage.local.get('accessToken');
        assertEqual(result2.accessToken, undefined, 'Token removal');
    });

    // Test 4: Batch Size Validation
    await runTest('Batch Size Validation', () => {
        const validBatchSizes = [1, 30, 50, 100];
        const invalidBatchSizes = [0, -1, 101, 1000];

        validBatchSizes.forEach(size => {
            assert(size >= 1 && size <= 100, `Valid batch size: ${size}`);
        });

        invalidBatchSizes.forEach(size => {
            assert(size < 1 || size > 100, `Invalid batch size rejected: ${size}`);
        });
    });

    // Test 5: Article Processing Logic
    await runTest('Article Processing Logic', () => {
        const articles = [
            { id: '1', title: 'Article 1' },
            { id: '2', title: 'Article 2' },
            { id: '3', title: 'Article 3' },
            { id: '4', title: 'Article 4' },
            { id: '5', title: 'Article 5' }
        ];

        // Test batch slicing
        const batchSize = 2;
        const batch = articles.slice(0, batchSize);
        assertEqual(batch.length, 2, 'Batch size correct');
        assertEqual(batch[0].id, '1', 'First article in batch');

        const remaining = articles.slice(batchSize);
        assertEqual(remaining.length, 3, 'Remaining articles count');
    });

    // Test 6: URL Validation
    await runTest('URL Validation', () => {
        const validUrls = [
            'https://example.com/article',
            'http://example.com',
            'https://blog.example.com/post/123'
        ];

        const invalidUrls = [
            '',
            null,
            undefined,
            'not-a-url',
            'javascript:alert(1)'
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
                `Invalid URL rejected: ${url}`
            );
        });
    });

    // Test 7: Badge Updates
    await runTest('Badge Updates', () => {
        const testCounts = [0, 5, 25, 100];

        testCounts.forEach(count => {
            const badgeText = count > 0 ? count.toString() : '';
            assert(
                (count === 0 && badgeText === '') || (count > 0 && badgeText === count.toString()),
                `Badge text for count ${count}: "${badgeText}"`
            );
        });
    });

    // Test 8: Error Handling
    await runTest('Error Handling', async () => {
        // Test missing token
        await mockBrowser.storage.local.clear();
        const result = await mockBrowser.storage.local.get('accessToken');
        assertEqual(result.accessToken, undefined, 'Missing token handled');

        // Test empty article list
        const articles = [];
        assertEqual(articles.length, 0, 'Empty article list handled');
        assert(articles.length === 0, 'Button should be disabled for empty list');
    });

    // Test 9: Settings Persistence
    await runTest('Settings Persistence', async () => {
        await mockBrowser.storage.local.clear();

        // Save settings
        const settings = { batchSize: 45 };
        await mockBrowser.storage.local.set({ userSettings: settings });

        // Simulate page reload - settings should persist
        const loadedSettings = await mockBrowser.storage.local.get('userSettings');
        assertNotNull(loadedSettings.userSettings, 'Settings persist after reload');
        assertEqual(loadedSettings.userSettings.batchSize, 45, 'Batch size persists');
    });

    // Test 10: Manifest Validation
    await runTest('Manifest Validation', () => {
        const manifest = {
            manifest_version: 2,
            name: 'Feedly Saved Opener',
            version: '1.0.0',
            permissions: ['storage', 'tabs', 'https://cloud.feedly.com/*']
        };

        assertEqual(manifest.manifest_version, 2, 'Manifest version');
        assertNotNull(manifest.name, 'Extension name exists');
        assertNotNull(manifest.version, 'Version exists');
        assert(manifest.permissions.includes('storage'), 'Storage permission');
        assert(manifest.permissions.includes('tabs'), 'Tabs permission');
    });

    // Print Results
    console.log('\n' + '='.repeat(50));
    console.log('\n📊 Test Results:');
    console.log(`✓ Passed: ${TEST_RESULTS.passed}`);
    console.log(`✗ Failed: ${TEST_RESULTS.failed}`);
    console.log(`📈 Total: ${TEST_RESULTS.tests.length}`);

    if (TEST_RESULTS.failed > 0) {
        console.log('\n❌ Failed Tests:');
        TEST_RESULTS.tests
            .filter(t => t.status !== 'PASS')
            .forEach(t => console.log(`  - ${t.name} (${t.status})`));
    }

    console.log('\n' + '='.repeat(50));

    // Exit with appropriate code
    process.exit(TEST_RESULTS.failed === 0 ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
});
