#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

source_path=$(jq -r --arg t "$SMOKE_LIVE_TENANT" '.tenants[$t]' "$PRAMANA_CONFIG")
[[ -n "$source_path" && -d "$source_path" ]] || _fail source-path "live tenant source path missing: $source_path"

req='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
resp=$(printf '%s\n' "$req" | "$PRAMANA_BIN" mcp --source "${source_path}:${SMOKE_LIVE_TENANT}" 2>/dev/null | grep -m1 '^{')

[[ -n "$resp" ]] || _fail mcp-no-response "no JSON-RPC response from pramana mcp"
echo "$resp" | jq -e '.result.protocolVersion' >/dev/null \
  || _fail mcp-bad-handshake "missing protocolVersion: $resp"
echo "$resp" | jq -e '.result.serverInfo.name=="pramana"' >/dev/null \
  || _fail mcp-serverinfo "unexpected serverInfo: $resp"
_pass "MCP stdio initialize handshake ok (proto=$(echo "$resp" | jq -r '.result.protocolVersion'))"
