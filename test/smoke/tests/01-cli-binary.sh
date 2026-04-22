#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

command -v "$PRAMANA_BIN" >/dev/null || _fail cli-on-path "$PRAMANA_BIN not on PATH"
_pass "binary on PATH: $(command -v "$PRAMANA_BIN")"

v=$("$PRAMANA_BIN" --version 2>&1) || _fail version-exits "--version exited non-zero"
[[ "$v" =~ ^pramana\ [0-9]+\.[0-9]+\.[0-9]+ ]] || _fail version-format "unexpected: $v"
_pass "version: $v"
