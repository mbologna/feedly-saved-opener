# Feedly Saved Opener

> Open your saved Feedly articles in batch with one click.

[![CI](https://github.com/mbologna/feedly-saved-opener/actions/workflows/ci.yml/badge.svg)](https://github.com/mbologna/feedly-saved-opener/actions/workflows/ci.yml)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox)](https://addons.mozilla.org/firefox/addon/feedly-saved-opener/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Firefox extension that opens all your saved Feedly articles in customizable batches and automatically unsaves them. Perfect for processing your reading list efficiently.

## Motivation

My RSS/Feedly workflow:
1. **On mobile**: Skim articles in NetNewsWire (synced to Feedly)
2. **Save interesting ones**: Quick save/star for later reading
3. **On desktop**: Want to read them all at once in Firefox

**The bottleneck**: Opening articles one-by-one from Feedly's web interface is tedious and time-consuming.

### The Solution

This extension opens all your saved Feedly articles in batches with a single click, automatically unsaving them as they open. Perfect for batch processing your reading list when you sit down at your desk.

## Features

- **Batch Opening**: Open 1-100 articles at once
- **Auto-Unsave**: Automatically removes saved status as articles open
- **Badge Counter**: Shows saved article count on toolbar icon
- **Customizable**: Adjust batch size to your needs
- **Sort Order**: Open newest or oldest saved articles first
- **Priority Domains**: List domains (e.g. `ilpost.it`) whose articles open before everything else
- **No 1000-Article Cap**: Fetches every saved article, following Feedly's pagination
- **Secure**: Token stored locally in browser storage
- **Free Tier**: Works with Feedly's free developer tokens
- **Smart Batching**: "Open All" mode processes every saved article in controlled batches with a cooldown between batches
- **Quick Batch via Context Menu**: Right-click the toolbar icon to open the next batch without opening the popup
- **Offline-Friendly**: Falls back to cached articles when the network is unavailable, with automatic retry on rate limits/server errors
- **Export**: Save your article URLs to a text file, or export your local click history as JSON
- **Stats Panel**: See your top sources and total articles opened from a local, on-device click log (clearable anytime)
- **Dark Mode**: Popup automatically adapts to your system theme

## Installation

### From Firefox Add-ons (Recommended)
1. Visit [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/feedly-saved-opener/)
2. Click "Add to Firefox"

### From Source
```bash
git clone https://github.com/mbologna/feedly-saved-opener.git
cd feedly-saved-opener
./build-extension.sh
```
Load the generated ZIP from `dist/` in Firefox via `about:debugging`.

## Quick Start

### First-Time Setup
1. Click the extension icon
2. Click "Get Token from Feedly"
3. Copy your token from https://feedly.com/i/console
4. Paste and save

### Usage
1. Click extension icon to see saved article count
2. Adjust batch size (default: 30)
3. Click "Open Saved Articles" to open batch
4. Articles open in background tabs and unsave automatically

Tip: press `R` in the popup to refresh the article count, or right-click the toolbar icon for a quick "Open Next Batch" action without opening the popup.

## Development

### Initial Setup
```bash
git clone https://github.com/mbologna/feedly-saved-opener.git
cd feedly-saved-opener
chmod +x setup.sh
./setup.sh
```

This will:
- Install all dependencies
- Set up Husky for git hooks
- Configure pre-commit linting
- Configure commit message validation

### Commit Message Format
We use [Conventional Commits](https://www.conventionalcommits.org/):

### Testing
```bash
npm test
```

### Linting
```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
```

### Building
```bash
npm run build
```

Output: `dist/feedly-saved-opener-v<version>.zip`

### Releasing

Releases are automated. Every Monday, the scheduled CI run tags a new version if a `feat`, `fix`, `perf`, `revert` or breaking commit landed since the last tag; chores, Renovate's `chore(deps)` updates among them, ship with the next such release. A Renovate `fix(security)` update is released at once, on its push. Conventional Commits pick the bump: `feat` → minor, `type!:` or `BREAKING CHANGE` → major, anything else → patch.

When a `v*.*.*` tag is built, the `publish` job in `.github/workflows/ci.yml`:
- sets the `manifest.json` version from the tag
- builds the ZIP, running lint and tests first
- creates a GitHub release with the ZIP, using the commits since the previous release as notes (Renovate `chore(deps)` commits left out)
- submits the build to Firefox Add-ons (listed channel) for review

The Firefox Add-ons step needs two repository secrets, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Get them from the [AMO API keys page](https://addons.mozilla.org/developers/addon/api/key/). Without them, the step is skipped with a warning.

To release right away instead of waiting for Monday:
```bash
npm run release
```
This bumps `package.json` and `manifest.json`, commits, tags and pushes. The tag push starts the same `publish` job. Running the CI workflow by hand on `main` (*Actions → CI → Run workflow*) releases at once too.

Weekly releases only push a tag; the version in `package.json`/`manifest.json` is only updated by `npm run release`. The GitHub releases are the full history.

## Privacy

- No data collection
- Token stored locally only
- No analytics or tracking
- Direct API communication with Feedly
