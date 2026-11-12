# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Feedly Saved Opener is a Manifest V3 browser extension that opens saved Feedly articles in batches and unsaves them. One codebase targets Firefox 140+, Edge/Chrome 148+ and Safari (macOS, personal builds). It has zero runtime dependencies and uses native ES modules; only Safari's background is bundled (esbuild, dev dependency).

## Commands

```bash
npm test                      # node --test over tests/**/*.test.js
npm run test:coverage         # same, with coverage
npm run lint                  # eslint
npm run build                 # lint + test + build all targets (build-extension.sh)
./build-extension.sh chromium # one or more of: firefox chromium safari
./build-safari.sh             # Xcode wrapper app for Safari (macOS + Xcode)
npm start                     # web-ext run on build/firefox
npm run release               # bump package.json + manifest.json, commit, tag
```

Releases are automated: the weekly scheduled CI run (Monday 06:00 UTC) tags a new version when a feat, fix, perf, revert or breaking commit landed, a push releases a `fix(security)` update at once, and the `publish` job in `.github/workflows/ci.yml` builds any `v*.*.*` tag, creates the GitHub release with the Firefox and Chromium ZIPs, and submits `build/firefox` to Firefox Add-ons (needs `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` secrets). It takes the version from the tag, not from `manifest.json`. PRs are squash-merged, so the PR title is the release commit.

## Architecture

Storage is the single source of truth. The background is the only part that calls Feedly and writes data; the popup writes only `userSettings`. Both react to `storage.onChanged`; messages carry commands, not state.

- `src/shared/core.js`: pure logic (no browser APIs): entry slimming, URL checks, sort order and priority domains (applied on read), settings normalization, click-log stats, formatting, popup view model.
- `src/shared/store.js`: `createStore(browser.storage)`. `local`: `accessToken`, `userId`, `userSettings`, `articles` (slim `{id,title,url,source,feedId}`, newest first), `syncedAt`, `authError`, `clickLog` (max 500). `session`: `job`, `syncStatus`. `migrate()` drops v2 keys (`cachedArticles`, `cacheTimestamp`, `cachedBadgeCount`).
- `src/background/index.js`: entry point. Registers every listener synchronously at top level (event page in Firefox/Safari, service worker in Chromium). Message actions: `sync`, `connect`, `disconnect`, `open` (`kind: 'batch'|'all'`), `cancel`, `clearClickLog`; replies `{ok, ...}` or `{error, kind}`.
- `src/background/feedly.js`: `createFeedlyClient`; every failure is a `FeedlyError` with `kind` (`auth`, `network`, `timeout`, `rate-limit`, `server`, `http`). Retries network errors, timeouts, 5xx and short 429s; never 401.
- `src/background/sync.js`: incremental sync: `streams/:id/ids`, then `entries/.mget` only for uncached ids. One in-flight run; errors keep the cache and land in `syncStatus`.
- `src/background/jobs.js`: batch runner. Job state is written to `storage.session` after every tab; a wake or the `job-watchdog` alarm resumes it, unsaving `pendingUnsave` first so nothing reopens. Optional tab groups via `tabs.group`/`tabGroups.update` when they exist.
- `src/popup/`: view over storage. No `innerHTML`; build DOM with `h()`/`textContent`. Native `<dialog>` for confirmations.
- `manifest.json` is the Firefox manifest; `scripts/manifest.js` derives `chromium` (module service worker, `minimum_chrome_version`) and `safari` (bundled classic background, no `tabGroups`).

## Conventions

- **API:** always `browser.*`. ESLint forbids `chrome` in `src/`.
- **Style:** 2-space indent, single quotes, semicolons, no trailing commas, `prefer-const`, `eqeqeq` (see `eslint.config.js`).
- **Commits:** Conventional Commits enforced by commitlint. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Max 100-char header.
- **Testing:** tests import the real modules. Background modules take their dependencies (`browser`, client, store, `sleep`, `now`) as arguments; use `tests/helpers/fake-browser.js` and `tests/helpers/fake-feedly.js`. `tests/background.test.js` loads `index.js` against the fakes.
- **Permissions:** adding one that shows a prompt disables the add-on for existing Firefox users until they accept; avoid it.
