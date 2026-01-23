#!/bin/bash

# Build script for Feedly Saved Opener Firefox Extension
# Creates a distributable .zip file

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║           Feedly Saved Opener Extension Builder            ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Configuration
EXTENSION_NAME="feedly-saved-opener"
BUILD_DIR="build"
DIST_DIR="dist"
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')

echo "Building version: ${VERSION}"
echo ""

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf "${BUILD_DIR}" "${DIST_DIR}"
mkdir -p "${BUILD_DIR}" "${DIST_DIR}"

# Check required files
echo "✅ Checking required files..."
required_files=(
    "manifest.json"
    "background.js"
    "popup/popup.html"
    "popup/popup.js"
    "README.md"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}✗ Missing required file: $file${NC}"
        exit 1
    fi
    echo "  ✓ $file"
done

# Check for icons
if [ ! -d "icons" ]; then
    echo -e "${YELLOW}⚠️  Warning: icons/ directory not found${NC}"
    echo "Creating placeholder icons..."
    mkdir -p icons

    # Create simple placeholder icons (solid color squares)
    if command -v convert &> /dev/null; then
        convert -size 48x48 xc:orange icons/icon-48.png
        convert -size 96x96 xc:orange icons/icon-96.png
        echo "  ✓ Created placeholder icons with ImageMagick"
    else
        echo -e "${YELLOW}  ImageMagick not found. Please add icons manually:${NC}"
        echo "    icons/icon-48.png (48x48)"
        echo "    icons/icon-96.png (96x96)"
        echo ""
        echo "  You can create them at: https://www.favicon-generator.org/"
        exit 1
    fi
fi

# Copy files to build directory
echo ""
echo "📦 Copying files to build directory..."
cp manifest.json "${BUILD_DIR}/"
cp background.js "${BUILD_DIR}/"
cp README.md "${BUILD_DIR}/"
cp -r popup "${BUILD_DIR}/"
cp -r icons "${BUILD_DIR}/"

echo "  ✓ All files copied"

# Create Firefox package (.xpi is just a renamed .zip)
echo ""
echo "🔨 Creating Firefox package..."
cd "${BUILD_DIR}"
zip -r "../${DIST_DIR}/${EXTENSION_NAME}-firefox-v${VERSION}.zip" . -x "*.DS_Store" -x "__MACOSX/*"
cd ..

FIREFOX_PACKAGE="${DIST_DIR}/${EXTENSION_NAME}-firefox-v${VERSION}.zip"
echo -e "  ✓ Created: ${GREEN}${FIREFOX_PACKAGE}${NC}"

# Create unsigned XPI (just a renamed zip)
cp "${FIREFOX_PACKAGE}" "${DIST_DIR}/${EXTENSION_NAME}-v${VERSION}.xpi"
echo -e "  ✓ Created: ${GREEN}${DIST_DIR}/${EXTENSION_NAME}-v${VERSION}.xpi${NC}"

# Calculate package size
PACKAGE_SIZE=$(du -h "${FIREFOX_PACKAGE}" | cut -f1)

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Build Successful! ✨                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "📦 Package Details:"
echo "   Name: ${EXTENSION_NAME}"
echo "   Version: ${VERSION}"
echo "   Size: ${PACKAGE_SIZE}"
echo ""
echo "📂 Output Files:"
echo "   ${FIREFOX_PACKAGE}"
echo "   ${DIST_DIR}/${EXTENSION_NAME}-v${VERSION}.xpi"
echo ""
echo "🚀 Installation Instructions:"
echo ""
echo "Option 1: Temporary (Testing)"
echo "  1. Open Firefox"
echo "  2. Go to: about:debugging#/runtime/this-firefox"
echo "  3. Click 'Load Temporary Add-on'"
echo "  4. Select: ${BUILD_DIR}/manifest.json"
echo ""
echo "Option 2: Permanent (Developer Edition)"
echo "  1. Install Firefox Developer Edition"
echo "  2. Go to about:config"
echo "  3. Set xpinstall.signatures.required = false"
echo "  4. Go to about:addons"
echo "  5. Install Add-on From File: ${DIST_DIR}/${EXTENSION_NAME}-v${VERSION}.xpi"
echo ""
echo "Option 3: Signed (For Distribution)"
echo "  1. Get API credentials: https://addons.mozilla.org/developers/addon/api/key/"
echo "  2. Install web-ext: npm install -g web-ext"
echo "  3. Run: web-ext sign --source-dir=${BUILD_DIR} --api-key=KEY --api-secret=SECRET"
echo ""
echo "🔧 For Chrome/Edge:"
echo "  1. Go to chrome://extensions/"
echo "  2. Enable Developer mode"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: ${BUILD_DIR}/"
echo ""

# Cleanup option
echo -e "${YELLOW}💡 To clean build files, run: rm -rf ${BUILD_DIR} ${DIST_DIR}${NC}"
echo ""
