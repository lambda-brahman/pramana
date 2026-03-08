#!/usr/bin/env bash
set -euo pipefail

# build.sh — Build compiled pramana binaries.
#
# Usage:
#   scripts/build.sh                     # Build for current platform
#   scripts/build.sh --all               # Build all platforms (CI)
#   scripts/build.sh --target <target>   # Build for specific target
#
# Handles build-time stubs for:
#   - react-devtools-core (ink dev dependency)
#   - onnxruntime-node → onnxruntime-web (native dylib → WASM, see #38)

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

# --- Swap onnxruntime-node → onnxruntime-web for compiled binary (#38) ------
# onnxruntime-node ships a .node native addon that dynamically links to
# libonnxruntime.dylib via @rpath. bun build --compile embeds the .node
# file but NOT the transitive dylib, so dlopen fails at runtime and
# semantic search silently falls back to FTS-only.
#
# Fix: replace onnxruntime-node with a re-export of onnxruntime-web (WASM)
# during compilation. The WASM backend is self-contained — no native deps.

ORT_NODE_DIR="node_modules/onnxruntime-node"
ORT_NODE_BACKUP="${ORT_NODE_DIR}.__real__"

stub_onnxruntime_node() {
  if [ -d "$ORT_NODE_DIR/bin" ]; then
    mv "$ORT_NODE_DIR" "$ORT_NODE_BACKUP"
    mkdir -p "$ORT_NODE_DIR"
    cat > "$ORT_NODE_DIR/package.json" <<'STUB'
{"name":"onnxruntime-node","version":"0.0.0-stub","main":"index.js","type":"commonjs"}
STUB
    cat > "$ORT_NODE_DIR/index.js" <<'STUB'
// Build-time stub: re-export onnxruntime-web so compiled binary uses WASM
// backend instead of native onnxruntime (which requires libonnxruntime dylib).
// See: https://github.com/sarath-soman/pramana/issues/38
module.exports = require("onnxruntime-web");
STUB
    echo "Stubbed onnxruntime-node → onnxruntime-web (WASM backend)"
  fi
}

restore_onnxruntime_node() {
  if [ -d "$ORT_NODE_BACKUP" ]; then
    rm -rf "$ORT_NODE_DIR"
    mv "$ORT_NODE_BACKUP" "$ORT_NODE_DIR"
    echo "Restored real onnxruntime-node"
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
stub_onnxruntime_node
trap restore_onnxruntime_node EXIT

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
