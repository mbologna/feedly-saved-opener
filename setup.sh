#!/bin/bash
set -e

echo "🚀 Setting up Feedly Saved Opener development environment..."
echo "============================================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🔧 Setting up Husky..."
npm run prepare

# Create Husky hooks directory if it doesn't exist
mkdir -p .husky

# Create pre-commit hook
echo "📝 Creating pre-commit hook..."
cat > .husky/pre-commit << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged
EOF
chmod +x .husky/pre-commit

# Create commit-msg hook
echo "📝 Creating commit-msg hook..."
cat > .husky/commit-msg << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx --no -- commitlint --edit ${1}
EOF
chmod +x .husky/commit-msg

# Create initial changelog if it doesn't exist
if [ ! -f CHANGELOG.md ]; then
    echo "📄 Creating initial CHANGELOG.md..."
    cat > CHANGELOG.md << 'EOF'
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - $(date +%Y-%m-%d)

### Added
- Initial release
- Batch opening of saved Feedly articles
- Auto-unsave functionality
- Customizable batch size
- Badge counter showing saved articles
- Smart batching mode
- Periodic badge updates every 5 minutes
EOF
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo "  - Run 'npm test' to run tests"
echo "  - Run 'npm run lint' to check code style"
echo "  - Run 'npm run build' to build the extension"
echo "  - Run 'npm run release' to create a new release"
echo ""
echo "💡 Commit message format:"
echo "  type(scope): subject"
echo ""
echo "  Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore"
echo "  Example: feat(badge): add periodic update every 5 minutes"
echo ""
