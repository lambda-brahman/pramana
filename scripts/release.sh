#!/usr/bin/env bash
set -euo pipefail

# release.sh — Bump version files, commit, tag, and push.
#
# Usage:
#   scripts/release.sh <version>
#
# Flow:
#   1. scripts/release.sh 0.10.0    → bumps version files, commits, tags v0.10.0, pushes
#   2. Tag push                     → ci.yml builds binaries + publishes release

VERSION="${1:?Usage: scripts/release.sh <version>}"
VERSION="${VERSION#v}" # strip leading v if present
TAG="v${VERSION}"

# --- Helpers ---------------------------------------------------------------

die() { echo "error: $*" >&2; exit 1; }

ensure_clean() {
  if [ -n "$(git status --porcelain)" ]; then
    die "Working tree is dirty. Commit or stash changes first."
  fi
}

ensure_on_main() {
  local current
  current=$(git branch --show-current)
  if [ "$current" != "main" ]; then
    die "Must be on main (currently on $current)."
  fi
}

# --- Main ------------------------------------------------------------------

ensure_clean
ensure_on_main
git pull --ff-only origin main

if git tag --list "$TAG" | grep -q "$TAG"; then
  die "Tag $TAG already exists."
fi

CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
echo "Bumping $CURRENT -> $VERSION"

# Update all version files
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$VERSION\"/" package.json

SRC_CURRENT=$(grep 'VERSION' src/version.ts | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
sed -i '' "s/VERSION = \"$SRC_CURRENT\"/VERSION = \"$VERSION\"/" src/version.ts

PLG_CURRENT=$(grep '"version"' plugin/.claude-plugin/plugin.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
sed -i '' "s/\"version\": \"$PLG_CURRENT\"/\"version\": \"$VERSION\"/" plugin/.claude-plugin/plugin.json

# marketplace.json has version in two places (metadata.version and plugins[].version)
sed -i '' "s/\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\"/\"version\": \"$VERSION\"/g" .claude-plugin/marketplace.json

git add package.json src/version.ts plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump version to $VERSION"

git tag -a "$TAG" -m "${TAG}"
git push origin main "$TAG"

echo ""
echo "Tagged and pushed $TAG"
echo "CI will build binaries and publish the GitHub release."
