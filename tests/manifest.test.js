import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildManifest, MINIMUM_CHROME_VERSION, SAFARI_BACKGROUND } from '../scripts/manifest.js';

const root = new URL('../', import.meta.url);
const base = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));

describe('manifest.json', () => {
  it('points at files that exist', () => {
    const files = [
      ...base.background.scripts,
      base.action.default_popup,
      ...Object.values(base.icons),
      ...Object.values(base.action.default_icon)
    ];
    for (const file of files) {
      assert.ok(existsSync(new URL(file, root)), file);
    }
  });

  it('asks only for what the extension uses', () => {
    assert.deepEqual(base.permissions, ['storage', 'alarms', 'contextMenus', 'tabGroups']);
    assert.deepEqual(base.host_permissions, ['https://cloud.feedly.com/*']);
    assert.deepEqual(base.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  });
});

describe('buildManifest', () => {
  it('leaves the Firefox manifest as it is', () => {
    assert.deepEqual(buildManifest(base, 'firefox'), base);
  });

  it('turns the background into a module service worker for Chromium', () => {
    const manifest = buildManifest(base, 'chromium');
    assert.deepEqual(manifest.background, { service_worker: 'src/background/index.js', type: 'module' });
    assert.equal(manifest.minimum_chrome_version, MINIMUM_CHROME_VERSION);
    assert.equal(manifest.browser_specific_settings, undefined);
    assert.equal(manifest.author, undefined);
    assert.ok(manifest.permissions.includes('tabGroups'));
    assert.ok(manifest.icons['128'], 'Chrome Web Store needs a 128px icon');
  });

  it('uses the bundled classic background, no tab groups and no Chrome minimum for Safari', () => {
    const manifest = buildManifest(base, 'safari');
    assert.deepEqual(manifest.background, { scripts: [SAFARI_BACKGROUND] });
    assert.equal(manifest.minimum_chrome_version, undefined);
    assert.equal(manifest.permissions.includes('tabGroups'), false);
  });

  it('does not modify its input', () => {
    const before = structuredClone(base);
    buildManifest(base, 'chromium');
    assert.deepEqual(base, before);
  });

  it('rejects unknown targets', () => {
    assert.throws(() => buildManifest(base, 'opera'), /Unknown target/);
  });
});
