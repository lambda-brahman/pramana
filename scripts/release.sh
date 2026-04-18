#!/usr/bin/env bash
set -euo pipefail

# release.sh — Bump Cargo workspace versions, commit, tag, push.
#
# Usage:
#   scripts/release.sh <version>
#
# Flow:
#   1. scripts/release.sh 0.15.0        → bumps crates/*/Cargo.toml + Cargo.lock, commits, tags, pushes
#   2. scripts/release.sh 0.15.0-rc.1   → same, but the GitHub release is marked as pre-release
#   3. Tag push                          → release-rust.yml builds binaries + publishes release

VERSION="${1:?Usage: scripts/release.sh <version>}"
VERSION="${VERSION#v}" # strip leading v if present
TAG="v${VERSION}"

die() { echo "error: $*" >&2; exit 1; }

ensure_clean() {
  if [ -n "$(git status --porcelain)" ]; then
    die "Working tree is dirty. Commit or stash changes first."
  fi
}

ensure_on_main() {
  local current
  current=$(git branch --show-current)
  [ "$current" = "main" ] || die "Must be on main (currently on $current)."
}

bump_cargo_versions() {
  local version="$1"
  for toml in crates/*/Cargo.toml; do
    sed -i '' "s/^version = \"[^\"]*\"/version = \"$version\"/" "$toml"
  done
  cargo generate-lockfile --quiet
}

ensure_clean
ensure_on_main
git pull --ff-only origin main

if git tag --list "$TAG" | grep -q "$TAG"; then
  die "Tag $TAG already exists."
fi

CURRENT=$(grep '^version' crates/pramana-cli/Cargo.toml | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
echo "Bumping $CURRENT -> $VERSION"

bump_cargo_versions "$VERSION"

STAGED_FILES=()
for toml in crates/*/Cargo.toml; do
  STAGED_FILES+=("$toml")
done
[ -f Cargo.lock ] && STAGED_FILES+=(Cargo.lock)

git add "${STAGED_FILES[@]}"
git commit -m "chore: bump version to $VERSION"

git tag -a "$TAG" -m "${TAG}"
git push origin main "$TAG"

echo ""
echo "Tagged and pushed $TAG"
echo "CI will build binaries and publish the GitHub release."
