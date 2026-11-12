#!/usr/bin/env bash
# Renders icons/icon-{16,32,48,96,128}.png from create_icons.html with a
# headless Chromium-based browser (Chrome, Edge or Chromium).
set -euo pipefail

cd "$(dirname "$0")/.."

browser="${BROWSER:-}"
if [ -z "$browser" ]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    google-chrome chromium chromium-browser microsoft-edge; do
    if command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ]; then
      browser="$candidate"
      break
    fi
  done
fi
if [ -z "$browser" ]; then
  echo "No Chromium-based browser found; set BROWSER=/path/to/browser" >&2
  exit 1
fi

profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT

"$browser" --headless --disable-gpu --no-first-run --user-data-dir="$profile" \
  --virtual-time-budget=2000 --dump-dom "file://$PWD/create_icons.html" 2>/dev/null \
  | node -e '
    const fs = require("node:fs");
    const html = fs.readFileSync(0, "utf8");
    const match = html.match(/<script type="application\/json" id="icon-data">([^<]+)<\/script>/);
    if (!match) {
      console.error("Icon data not found in the rendered page");
      process.exit(1);
    }
    for (const [size, url] of Object.entries(JSON.parse(match[1]))) {
      fs.writeFileSync(`icons/icon-${size}.png`, Buffer.from(url.split(",")[1], "base64"));
      console.log(`icons/icon-${size}.png`);
    }
  ' --input-type=commonjs
