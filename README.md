# Feedly Saved Opener

> Firefox extension to open saved Feedly articles in batches with one click.

[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox)](https://addons.mozilla.org/firefox/addon/feedly-saved-opener/)
[![Tests](https://github.com/mbologna/feedly-saved-opener/workflows/Tests/badge.svg)](https://github.com/mbologna/feedly-saved-opener/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/mbologna/feedly-saved-opener/releases)

---

## 📖 The Problem

My RSS/Feedly workflow:
1. **On mobile**: Skim articles in NetNewsWire (synced to Feedly)
2. **Save interesting ones**: Quick save/star for later reading
3. **On desktop**: Want to read them all at once in Firefox

**The bottleneck**: Opening articles one-by-one from Feedly's web interface is tedious and time-consuming.

## ✨ The Solution

This extension opens all your saved Feedly articles in batches with a single click, automatically unsaving them as they open. Perfect for batch processing your reading list when you sit down at your desk.

---

## 🚀 Features

- **⚡ Batch Opening**: Open 1-100 articles at once (customizable)
- **🔄 Auto-Unsave**: Automatically removes save/star as articles open
- **📊 Badge Counter**: Shows saved article count on toolbar icon
- **⚙️ Customizable**: Adjust batch size to your preference
- **🔐 Secure**: Token stored locally in encrypted browser storage
- **🆓 Free Tier Compatible**: Works with Feedly's free developer tokens
- **🎨 Modern UI**: Clean, polished interface with real-time updates

---

## 📦 Installation

1. Visit the [Firefox Add-ons page](https://addons.mozilla.org/firefox/addon/feedly-saved-opener/)
2. Click "Add to Firefox"
3. Done!

## 🎯 Quick Start

### First-Time Setup

1. **Click the extension icon** in your toolbar
2. **Click "Get Feedly Token"** button (opens Feedly Console)
3. **Copy your token** from https://feedly.com/i/console
4. **Paste token** in the extension popup
5. **Click "Save Token"**
6. **Done!** You're ready to use it

### Daily Use

1. **Click extension icon** - Shows your saved article count
2. **Adjust batch size** if needed (default: 30)
3. **Click "Open X Articles"** - Opens tabs and unsaves automatically
4. **Repeat** for next batch if you have more articles

### Tips

- **Badge shows count**: Glance at toolbar icon to see articles waiting
- **Keyboard shortcut**: Press `R` in popup to refresh count
- **Speed**: Articles open at 50ms intervals (optimized for speed)
- **Settings persist**: Your batch size preference is saved

---

## 🐛 Troubleshooting

### Extension Issues

**"No saved articles showing"**
- Click "Refresh Count" button
- Verify articles are saved in Feedly web interface
- Check you're using the correct Feedly account

**"Failed to load saved articles"**
- Token may be expired
- Generate new token at https://feedly.com/i/console
- Remove old token and add fresh one

**"Articles don't open"**
- Check popup blocker is disabled
- Try reducing batch size
- Ensure Firefox is up to date

**Badge shows "!"**
- Token is invalid or expired
- Click icon to see error details
- Generate new token
