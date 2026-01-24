# Feedly Saved Opener

> Open your saved Feedly articles in batch with one click.

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
- **Secure**: Token stored locally in browser storage
- **Free Tier**: Works with Feedly's free developer tokens
- **Smart Batching**: Optional mode to open all articles in controlled batches

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
- Create initial CHANGELOG.md

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

Output: `dist/feedly-saved-opener-v2.0.0.zip`

### Creating a Release

1. **Make changes and commit using conventional commits**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

2. **Generate changelog and bump version**
   ```bash
   npm run release
   ```
   This will:
   - Bump version in `package.json` and `manifest.json`
   - Generate/update `CHANGELOG.md`
   - Create a git tag
   - Commit the changes

3. **Push to GitHub**
   ```bash
   git push --follow-tags origin main
   ```

4. **GitHub Actions will automatically**:
   - Run tests
   - Build the extension
   - Create a GitHub release with the ZIP file
   - Use the generated changelog as release notes

## Privacy

- No data collection
- Token stored locally only
- No analytics or tracking
- Direct API communication with Feedly
