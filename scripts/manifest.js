#!/usr/bin/env node
/**
 * Renders the per-browser manifest from manifest.json (the Firefox manifest).
 *
 *   node scripts/manifest.js <firefox|chromium|safari> <out-file>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TARGETS = ['firefox', 'chromium', 'safari'];

// First Chrome/Edge release with the `browser` namespace and promise replies
// from runtime.onMessage, which the extension relies on
export const MINIMUM_CHROME_VERSION = '148';

export const SAFARI_BACKGROUND = 'src/background/bundle.js';

/**
 * @param {Object} base - parsed manifest.json
 * @param {'firefox'|'chromium'|'safari'} target
 * @returns {Object}
 */
export function buildManifest(base, target) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}", expected one of: ${TARGETS.join(', ')}`);
  }
  const manifest = structuredClone(base);
  if (target === 'firefox') {
    return manifest;
  }

  // Chromium runs the background as a module service worker
  delete manifest.browser_specific_settings;
  delete manifest.author;
  manifest.background = {
    service_worker: base.background.scripts[0],
    type: base.background.type
  };

  if (target === 'chromium') {
    manifest.minimum_chrome_version = MINIMUM_CHROME_VERSION;
  } else {
    // Safari's converter rejects module backgrounds, so build-extension.sh
    // bundles the background into one classic script for it
    manifest.background = { scripts: [SAFARI_BACKGROUND] };
    // No tab groups API in Safari
    manifest.permissions = manifest.permissions.filter(permission => permission !== 'tabGroups');
  }
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [target, out] = process.argv.slice(2);
  if (!target || !out) {
    console.error('Usage: node scripts/manifest.js <firefox|chromium|safari> <out-file>');
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  writeFileSync(out, `${JSON.stringify(buildManifest(base, target), null, 2)}\n`);
}
