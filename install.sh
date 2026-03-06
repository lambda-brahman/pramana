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
if [ -n "$1" ]; then
  VERSION="$1"
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"
else
  URL="https://github.com/${REPO}/releases/latest/download/${BINARY}"
fi

echo "Installing pramana (${OS}/${ARCH})..."

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMPFILE"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMPFILE" "$URL"
else
  echo "Error: curl or wget required" >&2
  exit 1
fi

chmod +x "$TMPFILE"
mkdir -p "$INSTALL_DIR"
mv "$TMPFILE" "$INSTALL_DIR/pramana"

echo "Installed pramana to ${INSTALL_DIR}/pramana"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add ${INSTALL_DIR} to your PATH:"; echo "  export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
esac
