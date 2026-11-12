#!/usr/bin/env bash
# Builds the extension for each browser.
#
#   ./build-extension.sh                 # all targets
#   ./build-extension.sh firefox         # one or more of: firefox chromium safari
#
# Output:
#   build/<target>/                              unpacked extension
#   dist/feedly-saved-opener-v<version>.zip            Firefox (AMO)
#   dist/feedly-saved-opener-v<version>-chromium.zip   Edge and Chrome
# Safari is only staged in build/safari/; ./build-safari.sh wraps it in an app.
set -euo pipefail

cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=(firefox chromium safari)
fi
for target in "${targets[@]}"; do
  case "$target" in
    firefox|chromium|safari) ;;
    *) echo -e "${RED}Unknown target: $target (expected firefox, chromium or safari)${NC}" >&2; exit 2 ;;
  esac
done

echo -e "${GREEN}Building Feedly Saved Opener: ${targets[*]}${NC}"

echo "Running lint..."
npm run --silent lint || { echo -e "${RED}Lint failed. Fix errors before building.${NC}"; exit 1; }

echo "Running tests..."
npm test --silent >/dev/null || { echo -e "${RED}Tests failed. Run npm test for details.${NC}"; exit 1; }

VERSION=$(node -p "require('./manifest.json').version")
echo -e "${YELLOW}Version: $VERSION${NC}"

mkdir -p dist
for target in "${targets[@]}"; do
  dir="build/$target"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -R src icons LICENSE "$dir/"
  node scripts/manifest.js "$target" "$dir/manifest.json"
  find "$dir" -name '.DS_Store' -delete

  case "$target" in
    firefox)
      echo "Checking the Firefox build with web-ext lint..."
      npx --no-install web-ext lint --source-dir "$dir" --warnings-as-errors --output text
      package="dist/feedly-saved-opener-v${VERSION}.zip"
      ;;
    chromium)
      package="dist/feedly-saved-opener-v${VERSION}-chromium.zip"
      ;;
    safari)
      # One classic script instead of modules for Safari's background
      npx --no-install esbuild src/background/index.js --bundle --format=iife --target=safari16 \
        --log-level=warning --outfile="$dir/src/background/bundle.js"
      find "$dir/src/background" -name '*.js' ! -name bundle.js -delete
      echo -e "${GREEN}✓ Safari staged in $dir; run ./build-safari.sh to build the app${NC}"
      continue
      ;;
  esac

  rm -f "$package"
  (cd "$dir" && zip -qr -X "../../$package" .)
  echo -e "${GREEN}✓ $package${NC}"
  unzip -l "$package"
done

echo ""
echo -e "${GREEN}✓ Build successful${NC}"
echo "Install for testing:"
echo "  Firefox:      about:debugging → This Firefox → Load Temporary Add-on → build/firefox/manifest.json"
echo "  Edge/Chrome:  edge://extensions or chrome://extensions → Developer mode → Load unpacked → build/chromium"
echo "  Safari:       ./build-safari.sh"
