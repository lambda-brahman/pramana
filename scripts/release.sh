#!/usr/bin/env bash
set -euo pipefail

# release.sh — Automate version bump and release PR creation.
#
# Usage:
#   scripts/release.sh <version>          # Create release PR
#   scripts/release.sh <version> --tag    # Manual fallback: tag after merge
#
# Normal flow:
#   1. scripts/release.sh 0.10.0    → creates PR on chore/release-v0.10.0
#   2. Merge PR                     → auto-tag.yml pushes v0.10.0 tag
#   3. Tag push                     → ci.yml builds binaries + publishes release
#
# The --tag flag is a manual fallback if auto-tag doesn't fire.

VERSION="${1:?Usage: scripts/release.sh <version> [--tag]}"
VERSION="${VERSION#v}" # strip leading v if present
TAG="v${VERSION}"
BRANCH="chore/release-${TAG}"
MODE="${2:-}"

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

# --- Tag mode (manual fallback) --------------------------------------------

if [ "$MODE" = "--tag" ]; then
  ensure_on_main
  git pull --ff-only origin main

  pkg_ver=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
  src_ver=$(grep 'VERSION' src/version.ts | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
  plg_ver=$(grep '"version"' plugin/.claude-plugin/plugin.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
  mkt_ver=$(grep '"version"' .claude-plugin/marketplace.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')

  [ "$pkg_ver" = "$VERSION" ] || die "package.json has $pkg_ver, expected $VERSION"
  [ "$src_ver" = "$VERSION" ] || die "src/version.ts has $src_ver, expected $VERSION"
  [ "$plg_ver" = "$VERSION" ] || die "plugin.json has $plg_ver, expected $VERSION"
  [ "$mkt_ver" = "$VERSION" ] || die "marketplace.json has $mkt_ver, expected $VERSION"

  if git tag --list "$TAG" | grep -q "$TAG"; then
    die "Tag $TAG already exists."
  fi

  git tag -a "$TAG" -m "${TAG}"
  git push origin "$TAG"
  echo "Tagged and pushed $TAG"
  echo "CI will build binaries and publish the GitHub release."
  exit 0
fi

# --- PR mode (default) -----------------------------------------------------

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

git checkout -b "$BRANCH"
git add package.json src/version.ts plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump version to $VERSION"
git push -u origin "$BRANCH"

# Build changelog
PREV_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
CHANGELOG=""
if [ -n "$PREV_TAG" ]; then
  CHANGELOG=$(git log --oneline "${PREV_TAG}..HEAD" --no-merges | grep -v "bump version" | sed 's/^/- /' || true)
fi

gh pr create \
  --title "chore: bump version to $VERSION" \
  --body "$(cat <<EOF
## Summary
- Bump version in \`package.json\`, \`src/version.ts\`, and \`plugin.json\` to $VERSION

${CHANGELOG:+## Changes since $PREV_TAG
$CHANGELOG
}
## Release automation
Merging this PR will automatically:
1. **auto-tag.yml** creates and pushes \`$TAG\`
2. **ci.yml** builds binaries and publishes the GitHub release
EOF
)" --label "chore"

git checkout main
echo ""
echo "PR created. Merge it and the release is fully automated."
