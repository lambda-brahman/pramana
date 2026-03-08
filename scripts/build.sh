#!/usr/bin/env bash
set -euo pipefail

# build.sh — Build compiled pramana binaries.
#
# Usage:
#   scripts/build.sh                     # Build for current platform
#   scripts/build.sh --all               # Build all platforms (CI)
#   scripts/build.sh --target <target>   # Build for specific target
#
# Handles the react-devtools-core stub needed for ink/bun compile compatibility.

ENTRY="src/cli/index.ts"

# --- Stub react-devtools-core so bun compile can resolve it -----------------
# ink dynamically imports devtools.js which has a static import of
# react-devtools-core. The import is guarded by isDev() (DEV=true) and
# never runs in production, but bun's bundler still resolves it at
# compile time. We provide an empty stub so bundling succeeds.

stub_devtools() {
  if [ ! -d node_modules/react-devtools-core ]; then
    mkdir -p node_modules/react-devtools-core
    cat > node_modules/react-devtools-core/package.json <<'STUB'
{"name":"react-devtools-core","version":"0.0.0","main":"index.js"}
STUB
    cat > node_modules/react-devtools-core/index.js <<'STUB'
module.exports = { initialize() {}, connectToDevTools() {} };
STUB
    echo "Created react-devtools-core stub"
  fi
}

build_target() {
  local target="$1"
  local outfile="$2"
  echo "Building $outfile ($target)..."
  bun build "$ENTRY" --compile --target="$target" --outfile "$outfile"
}

# --- Main -------------------------------------------------------------------

stub_devtools

MODE="${1:-}"

if [ "$MODE" = "--all" ]; then
  build_target bun-darwin-arm64 pramana-darwin-arm64
  build_target bun-darwin-x64   pramana-darwin-x64
  build_target bun-linux-x64    pramana-linux-x64
  build_target bun-linux-arm64  pramana-linux-arm64
  build_target bun-windows-x64  pramana-windows-x64.exe
  echo "All targets built."
elif [ "$MODE" = "--target" ]; then
  TARGET="${2:?Usage: scripts/build.sh --target <bun-target>}"
  # Derive output name from target
  OUTFILE="pramana-${TARGET#bun-}"
  [[ "$TARGET" == *windows* ]] && OUTFILE="${OUTFILE}.exe"
  build_target "$TARGET" "$OUTFILE"
else
  # Build for current platform
  bun build "$ENTRY" --compile --outfile pramana
  echo "Built: ./pramana"
fi
