#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

source_path=$(jq -r --arg t "$SMOKE_LIVE_TENANT" '.tenants[$t]' "$PRAMANA_CONFIG")
[[ -n "$source_path" && -d "$source_path" ]] || _fail source-path "live tenant source path missing"

script=$(cat <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
)

# Give server a moment to process each line; 1s is plenty.
resp=$( (printf '%s\n' "$script"; sleep 1) | "$PRAMANA_BIN" mcp --source "${source_path}:${SMOKE_LIVE_TENANT}" 2>/dev/null \
  | grep '^{' | jq -c 'select(.id==2)' | head -1 )

[[ -n "$resp" ]] || _fail tools-list-no-response "no response to tools/list"
count=$(echo "$resp" | jq -r '.result.tools | length')
(( count > 0 )) || _fail tools-list-empty "tools/list returned 0 tools: $resp"
names=$(echo "$resp" | jq -r '.result.tools[].name' | paste -sd, -)
_pass "MCP tools/list returned $count tool(s): $names"
