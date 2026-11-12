#!/usr/bin/env bash
# Wraps the Safari build in a macOS app with Xcode, for personal use (nothing is
# published). Needs macOS with full Xcode, not just the command line tools.
#
#   ./build-safari.sh                          # ad-hoc signed
#   DEVELOPMENT_TEAM=ABCDE12345 ./build-safari.sh   # signed with your Apple ID team
#
# Ad-hoc signed builds only load with Safari → Settings → Developer → "Allow
# unsigned extensions", which Safari turns off again when it quits. Signing with
# a team (a free Apple ID works: Xcode → Settings → Accounts) avoids that.
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="Feedly Saved Opener"
# The converter names the app "<prefix>.<App-Name>" and the extension
# "<id>.Extension"; this id keeps the extension under the app as Xcode requires
BUNDLE_ID="${BUNDLE_ID:-net.michelebologna.Feedly-Saved-Opener}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications}"
PROJECT_DIR="build/xcode"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Safari builds need macOS" >&2
  exit 1
fi
if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "safari-web-extension-converter not found: install Xcode and run 'sudo xcode-select -s /Applications/Xcode.app'" >&2
  exit 1
fi

./build-extension.sh safari

rm -rf "$PROJECT_DIR"
xcrun safari-web-extension-converter build/safari \
  --project-location "$PROJECT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

signing=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=)
if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
  signing=(CODE_SIGN_STYLE=Automatic "DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM" -allowProvisioningUpdates)
fi

xcodebuild \
  -project "$PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath build/xcode-derived \
  "${signing[@]}" \
  build | tail -n 5

app="build/xcode-derived/Build/Products/Release/$APP_NAME.app"
mkdir -p "$INSTALL_DIR"
rm -rf "${INSTALL_DIR:?}/$APP_NAME.app"
cp -R "$app" "$INSTALL_DIR/"
open "$INSTALL_DIR/$APP_NAME.app"

cat <<MSG

Installed $INSTALL_DIR/$APP_NAME.app. To turn it on:
  1. Safari → Settings → Extensions → tick "$APP_NAME"
MSG
if [ -z "${DEVELOPMENT_TEAM:-}" ]; then
  echo "     (first: Safari → Settings → Advanced → \"Show features for web developers\","
  echo "      then Developer → \"Allow unsigned extensions\"; Safari resets this on quit)"
fi
cat <<MSG
  2. Click the toolbar button and allow it on cloud.feedly.com ("Always Allow")
MSG
