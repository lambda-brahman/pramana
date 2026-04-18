#!/usr/bin/env bash
set -euo pipefail

# release.sh — Bump version files, commit, tag, and push.
#
# Usage:
#   scripts/release.sh <version>
#
# Flow:
#   1. scripts/release.sh 0.14.0        → bumps version files, commits, tags v0.14.0, pushes
#   2. scripts/release.sh 0.14.0-rc.1   → same, but the GitHub release is marked as pre-release
#   3. Tag push                          → release-rust.yml builds binaries + publishes release
#
# Supports both stable (0.14.0) and pre-release (0.14.0-rc.1) versions.
# Works from main or rust-port branches.

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

ensure_on_release_branch() {
  local current
  current=$(git branch --show-current)
  case "$current" in
    main|rust-port) ;;
    *) die "Must be on main or rust-port (currently on $current)." ;;
  esac
}

bump_cargo_versions() {
  local version="$1"
  for toml in crates/*/Cargo.toml; do
    sed -i '' "s/^version = \"[^\"]*\"/version = \"$version\"/" "$toml"
  done
  if command -v cargo >/dev/null 2>&1; then
    cargo generate-lockfile --quiet
  fi
}

# --- Main ------------------------------------------------------------------

BRANCH=$(git branch --show-current)

ensure_clean
ensure_on_release_branch
git pull --ff-only origin "$BRANCH"

if git tag --list "$TAG" | grep -q "$TAG"; then
  die "Tag $TAG already exists."
fi

CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9][0-9.a-zA-Z-]*\)".*/\1/')
echo "Bumping $CURRENT -> $VERSION"

# --- TypeScript version files ---
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$VERSION\"/" package.json

SRC_CURRENT=$(grep 'VERSION' src/version.ts | head -1 | sed 's/.*"\([0-9][0-9.a-zA-Z-]*\)".*/\1/')
sed -i '' "s/VERSION = \"$SRC_CURRENT\"/VERSION = \"$VERSION\"/" src/version.ts

PLG_CURRENT=$(grep '"version"' plugin/.claude-plugin/plugin.json | head -1 | sed 's/.*"\([0-9][0-9.a-zA-Z-]*\)".*/\1/')
sed -i '' "s/\"version\": \"$PLG_CURRENT\"/\"version\": \"$VERSION\"/" plugin/.claude-plugin/plugin.json

sed -i '' "s/\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^\"]*\"/\"version\": \"$VERSION\"/g" .claude-plugin/marketplace.json

# --- Rust workspace versions ---
bump_cargo_versions "$VERSION"

# --- Commit, tag, push ---
STAGED_FILES=(
  package.json
  src/version.ts
  plugin/.claude-plugin/plugin.json
  .claude-plugin/marketplace.json
)

for toml in crates/*/Cargo.toml; do
  STAGED_FILES+=("$toml")
done

if [ -f Cargo.lock ]; then
  STAGED_FILES+=(Cargo.lock)
fi

git add "${STAGED_FILES[@]}"
git commit -m "chore: bump version to $VERSION"

git tag -a "$TAG" -m "${TAG}"
git push origin "$BRANCH" "$TAG"

echo ""
echo "Tagged and pushed $TAG"
echo "CI will build binaries and publish the GitHub release."
