#!/bin/bash

# Script to publish the Weather Data Orchestrator to npm

echo "🚀 Publishing Weather Data Orchestrator to npm..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Check if user is logged in to npm
if ! npm whoami > /dev/null 2>&1; then
    echo "❌ Error: Not logged in to npm. Please run 'npm login' first."
    exit 1
fi

# Run tests before publishing
echo "🧪 Running tests..."
npm test
if [ $? -ne 0 ]; then
    echo "❌ Tests failed. Aborting publication."
    exit 1
fi

# Check if version is already published
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"

if npm view om-file-orchestrator@$CURRENT_VERSION version > /dev/null 2>&1; then
    echo "❌ Version $CURRENT_VERSION is already published. Please update the version in package.json"
    exit 1
fi

# Build/validate the package
echo "🔨 Validating package..."
npm pack --dry-run
if [ $? -ne 0 ]; then
    echo "❌ Package validation failed."
    exit 1
fi

# Publish to npm
echo "📤 Publishing to npm..."
npm publish

if [ $? -eq 0 ]; then
    echo "✅ Successfully published om-file-orchestrator@$CURRENT_VERSION to npm!"
    echo "📋 Package URL: https://www.npmjs.com/package/om-file-orchestrator"
    echo "📋 Installation: npm install om-file-orchestrator"
else
    echo "❌ Failed to publish to npm."
    exit 1
fi

