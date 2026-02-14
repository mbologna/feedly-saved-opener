# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Feedly Saved Opener is a Firefox browser extension (Manifest V3) that opens saved/starred Feedly articles in batch with automatic unsaving. It uses the `browser` WebExtensions API (not `chrome`), requires Firefox 109+, and has zero runtime dependencies.

## Commands

```bash
npm test              # run all tests (node tests/test.js)
npm run lint          # eslint check
npm run lint:fix      # eslint auto-fix
npm run build         # build extension zip into dist/
npm run release       # bump version (package.json + manifest.json), update CHANGELOG, create git tag
```

## Architecture

**IPC-based design:** The popup and background service worker communicate via `browser.runtime.sendMessage`. The popup never calls the Feedly API directly.

- **`background.js`** — Service worker handling all Feedly API calls, badge updates, tab creation, and alarms. Contains `FeedlyAPI` class (static methods), `processBatch` (opens tabs with 150ms delay, fire-and-forget unstar), retry logic (max 3, exponential backoff on 429/5xx, no retry on 401), and a 5-minute article cache. Uses `browser.alarms` for periodic badge updates every 60 minutes.
- **`popup/popup.js`** — UI logic with a view state machine (`loading` → `auth`/`notAuth`/`error`; within `auth`: `content` vs `empty`). Sends IPC messages: `checkAuth`, `saveToken`, `logout`, `getArticles`, `openBatch`. Includes XSS protection via `escapeHtml`.
- **`popup/popup.html`** — Self-contained popup with inline CSS (380px wide, dark mode support).
- **`tests/test.js`** — Custom test framework (~120 tests, no external dependencies). Uses `createMockBrowser` to simulate the WebExtensions API. Core logic functions are re-implemented inline for isolation rather than imported from source.

## Conventions

- **Style:** 2-space indent, single quotes, semicolons required, no trailing commas, `prefer-const`, `eqeqeq: always` (see `.eslintrc.json`)
- **Commits:** Conventional Commits enforced by commitlint. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Max 100 char header.
- **API:** Always use `browser.*` (Firefox WebExtensions global), never `chrome.*`.
- **Testing:** Tests run in Node.js with mocked browser APIs. When adding features, replicate the relevant logic in `tests/test.js` since it doesn't import from source files directly.
