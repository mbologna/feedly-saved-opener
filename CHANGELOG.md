# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-08

### Added
- "Open All" smart batching mode that processes every saved article in controlled batches with a cooldown between batches
- Export saved article URLs to a text file
- Local click-log stats panel (top sources, totals) with JSON export and a clear/reset action
- Context menu "Open Next Batch" action on the toolbar icon
- Offline support: falls back to cached articles when the network is unavailable
- Retry logic with exponential backoff for rate-limited (429) and server-error (5xx) API responses
- Confirmation modals for destructive actions (logout, clearing click history, "Open All")
- Toast notifications for non-fatal errors and status updates
- Dark mode support in the popup UI
- Badge error state (red "!") when authentication expires

### Changed
- Badge article count now refreshes via `browser.alarms` every 15 minutes (previously relied on less reliable periodic timers)
- Tab-opening delay tuned to 150ms between tabs for better reliability
- Saved articles are now cached for 5 minutes to reduce redundant API calls

### Security
- Removed the unused `tabs` permission — the extension only creates tabs and never reads tab URLs/titles, so it doesn't need it
- Click log is now capped at 500 entries to prevent unbounded local storage growth

## [1.0.0] - 2026-01-23

### Added
- Initial release of Feedly Saved Opener
- Batch opening of saved Feedly articles (customizable 1-100)
- Automatic unsaving of articles as they open
- Badge notification showing saved article count
- Feedly Token authentication (works with free tier)
- Settings persistence across sessions
- Real-time batch size updates
- Modern gradient UI with purple theme
- Token input validation with visual feedback
- Auto-focus on token input after logout
- Smooth transitions and animations
- Browser startup badge update
- Empty state with friendly message
- Comprehensive error handling
- Icon generator tool
- Build automation script
- Complete test suite (10 tests)
- GitHub Actions CI/CD
- Automated releases
- Pre-commit hooks configuration
