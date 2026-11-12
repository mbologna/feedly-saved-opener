# Feedly Saved Opener

> Open your saved Feedly articles in batches, then unsave them, in Firefox, Edge, Chrome and Safari.

[![CI](https://github.com/mbologna/feedly-saved-opener/actions/workflows/ci.yml/badge.svg)](https://github.com/mbologna/feedly-saved-opener/actions/workflows/ci.yml)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox)](https://addons.mozilla.org/firefox/addon/feedly-saved-opener/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The extension reads your Feedly "Saved for later" list, opens the articles in background tabs in batches of your chosen size, and unsaves each batch once its tabs are open.

## Motivation

My RSS workflow:
1. On mobile, skim articles in NetNewsWire (synced to Feedly).
2. Save the interesting ones.
3. On the desktop, read them all in the browser.

Opening saved articles one by one from Feedly's web interface is slow. This extension opens a batch with one click and clears it from the saved list.

## Features

- **Batches:** open 1–100 articles at a time, or all of them in batches with a one-second pause between batches.
- **Keeps going in the background:** "Open all" runs in the extension's background script, so closing the popup does not stop it. Reopening the popup shows progress and a Stop button.
- **Unsaves as it goes:** each batch is unsaved right after its tabs open. If the browser suspends the extension mid-run, it unsaves the tabs already opened before opening more, so no article opens twice.
- **Tab groups:** optionally put each run's tabs in one group named after the day, e.g. `Feedly · 12 Nov` (Firefox 139+, Chrome, Edge).
- **Keyboard shortcut:** `Alt+Shift+O` opens the next batch without the popup. Change it in the browser's extension shortcuts settings.
- **Toolbar menu:** right-click the toolbar button for "Open next 30 articles", "Open all 74 saved articles" and "Refresh saved list".
- **Order:** newest or oldest saved first, with a list of priority domains (e.g. `ilpost.it`) whose articles open before the rest.
- **Badge:** the saved count on the toolbar button, green while a run is in progress, `!` when Feedly rejects the token.
- **Instant popup:** the popup draws the cached list straight away and refreshes it in the background when it is more than two minutes old.
- **Offline:** when Feedly cannot be reached, the cached list stays usable and the popup says so.
- **Export and stats:** save the article URLs to a text file; see your top sources from a local log of opened articles (last 500), and export or clear it.

## Installation

### Firefox

Install from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/feedly-saved-opener/). Needs Firefox 140 or later.

### Edge and Chrome

Store listings are not live yet. Until then, download `feedly-saved-opener-v<version>-chromium.zip` from the [latest release](https://github.com/mbologna/feedly-saved-opener/releases/latest), unzip it, open `edge://extensions` or `chrome://extensions`, turn on *Developer mode* and choose *Load unpacked*. Needs Edge or Chrome 148 or later.

### Safari (macOS)

Safari extensions ship inside a Mac app. To build one for your own Mac you need full Xcode (free); no Apple Developer membership is required:

```bash
./build-safari.sh
```

The script builds the app, copies it to `~/Applications` and opens it. Then enable the extension in Safari → Settings → Extensions and allow it on `cloud.feedly.com`.

An ad-hoc signed build needs Safari's *Allow unsigned extensions* developer setting, which Safari turns off again when it quits. To avoid that, sign in to Xcode with an Apple ID (Xcode → Settings → Accounts) and pass its team ID:

```bash
DEVELOPMENT_TEAM=ABCDE12345 ./build-safari.sh
```

Safari has no tab groups API, so that setting is hidden there. Whether Safari shows the toolbar right-click menu has not been tested.

## Quick start

1. Click the toolbar button, then "Get a token from Feedly".
2. Copy your developer token from <https://feedly.com/i/console> and paste it into the popup. The extension checks it with Feedly before saving it.
3. Click "Open 30 articles", or "Open all".

Feedly developer tokens expire. When Feedly rejects the token, the badge shows `!` and the popup asks for a new one; settings and history are kept.

Press `R` in the popup to refresh the list.

## Permissions

| Permission | Used for |
|---|---|
| `storage` | The token, settings, the cached list and the local click log |
| `alarms` | Refreshing the badge every 15 minutes; resuming a run the browser suspended |
| `contextMenus` | The toolbar right-click menu |
| `tabGroups` | Naming the tab group (Firefox and Chromium; no permission prompt) |
| `https://cloud.feedly.com/*` | Feedly's API |

Shortcuts use the `commands` manifest key, which needs no permission.

## Privacy

- No analytics, tracking or third-party services.
- The token, cache and click log stay in the browser's extension storage, which is not encrypted.
- The extension talks only to `cloud.feedly.com`.

## How it works

Extension storage is the single source of truth. The background script is the only part that calls Feedly; the popup reads storage, re-renders when it changes, and sends commands as messages.

```
src/
  shared/core.js        pure logic: ordering, priority domains, settings, stats, formatting
  shared/store.js       typed access to storage.local and storage.session
  background/index.js   listeners: messages, alarms, menus, shortcut, install/update
  background/feedly.js  API client: typed errors, retries, Retry-After
  background/sync.js    incremental sync of the saved list
  background/jobs.js    batch runner: open, group, unsave; resumable and cancellable
  background/badge.js   badge from stored state
  popup/                popup.html, popup.css, popup.js
manifest.json           Firefox manifest; scripts/manifest.js derives the others
```

A sync fetches the list of saved entry ids (`/v3/streams/:id/ids`), then downloads full entries (`/v3/entries/.mget`) only for ids not already cached, and keeps title, link and source of each. With nothing new, a sync is one request per page of ids; the extension asks for 1,000 ids a page, and Feedly documents a maximum of 250, so a large list may take a few. Feedly allows 100,000 requests a month per token ([request limits](https://developers.feedly.com/reference/request-limits)).

The code uses `browser.*` everywhere. Firefox and Safari have always provided it; Chrome and Edge do since version 148, together with promise replies from `runtime.onMessage`. The extension has no runtime dependencies and no bundler, except for Safari's background script, which is bundled with esbuild because Safari's converter does not accept module backgrounds.

## Development

```bash
git clone https://github.com/mbologna/feedly-saved-opener.git
cd feedly-saved-opener
./setup.sh                # npm install plus commit hooks
```

| Command | Does |
|---|---|
| `npm test` | Unit and integration tests (`node --test`, real modules against fake browser and Feedly APIs) |
| `npm run test:coverage` | The same with a coverage report |
| `npm run lint` | ESLint |
| `npm run build` | Lint, test, then build every target |
| `./build-extension.sh firefox` | Build one or more targets: `firefox`, `chromium`, `safari` |
| `npm start` | Run `build/firefox` in a temporary Firefox profile (`web-ext run`) |
| `npm run start:chromium` | The same for `build/chromium` in Chrome |
| `scripts/render-icons.sh` | Render `icons/` from `create_icons.html` with a headless Chromium browser |

The build writes unpacked extensions to `build/<target>/` and these packages to `dist/`:

- `feedly-saved-opener-v<version>.zip` for Firefox, checked with `web-ext lint`;
- `feedly-saved-opener-v<version>-chromium.zip` for Edge and Chrome.

Safari is staged in `build/safari/`; `./build-safari.sh` turns it into an app.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint.

### Releasing

Releases are automated. Every Monday, the scheduled CI run tags a new version if a `feat`, `fix`, `perf`, `revert` or breaking commit landed since the last tag; chores, Renovate's `chore(deps)` updates among them, ship with the next such release. A Renovate `fix(security)` update is released at once, on its push. Conventional Commits pick the bump: `feat` → minor, `type!:` or `BREAKING CHANGE` → major, anything else → patch.

When a `v*.*.*` tag is built, the `publish` job in `.github/workflows/ci.yml`:
- sets the `manifest.json` version from the tag
- builds every target, running lint and tests first
- creates a GitHub release with the Firefox and Edge/Chrome ZIPs, using the commits since the previous release as notes (Renovate `chore(deps)` commits left out)
- submits `build/firefox` to Firefox Add-ons (listed channel) for review

The Firefox Add-ons step needs two repository secrets, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Get them from the [AMO API keys page](https://addons.mozilla.org/developers/addon/api/key/). Without them, the step is skipped with a warning. Uploads to Edge Add-ons and the Chrome Web Store are manual.

To release right away instead of waiting for Monday:
```bash
npm run release
```
This bumps `package.json` and `manifest.json`, commits, tags and pushes. The tag push starts the same `publish` job. Running the CI workflow by hand on `main` (*Actions → CI → Run workflow*) releases at once too.

Weekly releases only push a tag; the version in `package.json`/`manifest.json` is only updated by `npm run release`. The GitHub releases are the full history.
