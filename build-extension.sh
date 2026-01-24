#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building Feedly Saved Opener Extension${NC}"
echo "========================================"

# Get version from manifest
VERSION=$(grep -o '"version": *"[^"]*"' manifest.json | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
echo -e "${YELLOW}Version: $VERSION${NC}"

# Create dist directory
echo "Creating dist directory..."
rm -rf dist
mkdir -p dist

# Package name
PACKAGE_NAME="feedly-saved-opener-v${VERSION}.zip"

# Files to include
echo "Packaging files..."
zip -r "dist/${PACKAGE_NAME}" \
  manifest.json \
  background.js \
  popup/ \
  icons/ \
  LICENSE \
  -x "*.DS_Store" \
  -x "*~" \
  -x "*/.*"

# Verify the package
echo ""
echo -e "${GREEN}Build complete!${NC}"
echo "Package: dist/${PACKAGE_NAME}"
echo ""
echo "Contents:"
unzip -l "dist/${PACKAGE_NAME}"

echo ""
echo -e "${GREEN}✓ Build successful${NC}"
echo "To install: Load dist/${PACKAGE_NAME} in Firefox via about:debugging"
