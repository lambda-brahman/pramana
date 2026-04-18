#!/bin/sh
set -e

REPO="lambda-brahman/pramana"
INSTALL_DIR="${PRAMANA_INSTALL:-$HOME/.local/bin}"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) ;;
  linux) ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

BINARY="pramana-${OS}-${ARCH}"

# Determine version
if [ -n "${1:-}" ]; then
  VERSION="$1"
  BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
else
  BASE_URL="https://github.com/${REPO}/releases/latest/download"
fi

URL="${BASE_URL}/${BINARY}"
CHECKSUM_URL="${BASE_URL}/${BINARY}.sha256"

echo "Installing pramana (${OS}/${ARCH})..."

TMPDIR_DL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_DL"' EXIT
TMPFILE="${TMPDIR_DL}/${BINARY}"
TMPCHECKSUM="${TMPDIR_DL}/${BINARY}.sha256"

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    echo "Error: curl or wget required" >&2
    exit 1
  fi
}

fetch "$URL" "$TMPFILE"

# Verify checksum if available
if fetch "$CHECKSUM_URL" "$TMPCHECKSUM" 2>/dev/null; then
  EXPECTED=$(awk '{print $1}' "$TMPCHECKSUM")
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$TMPFILE" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$TMPFILE" | awk '{print $1}')
  else
    echo "Warning: cannot verify checksum (no sha256sum or shasum)" >&2
    ACTUAL="$EXPECTED"
  fi
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "Error: checksum mismatch" >&2
    echo "  expected: $EXPECTED" >&2
    echo "  actual:   $ACTUAL" >&2
    exit 1
  fi
  echo "Checksum verified."
fi

chmod +x "$TMPFILE"
mkdir -p "$INSTALL_DIR"
mv "$TMPFILE" "$INSTALL_DIR/pramana"

echo "Installed pramana to ${INSTALL_DIR}/pramana"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add ${INSTALL_DIR} to your PATH:"; echo "  export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
esac
