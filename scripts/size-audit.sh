#!/usr/bin/env bash
set -euo pipefail

# size-audit.sh — Measure dependency contributions to compiled binary size.
#
# Builds the binary twice (full and with MCP SDK stubbed out) to isolate
# the SDK's contribution to binary size and module count.

BINARY_FULL=$(mktemp -t pramana-full-XXXXXX)
BINARY_STUB=$(mktemp -t pramana-stub-XXXXXX)
MCP_SERVER="src/mcp/server.ts"
MCP_BACKUP="${MCP_SERVER}.__audit__"
trap 'rm -f "$BINARY_FULL" "$BINARY_STUB"; [ -f "$MCP_BACKUP" ] && mv "$MCP_BACKUP" "$MCP_SERVER"' EXIT

get_size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

format_bytes() {
  local b="$1"
  if [ "$b" -ge 1048576 ]; then
    printf "%.1fM" "$(echo "$b / 1048576" | bc -l)"
  elif [ "$b" -ge 1024 ]; then
    printf "%.1fK" "$(echo "$b / 1024" | bc -l)"
  else
    printf "%dB" "$b"
  fi
}

echo "=== Pramana Binary Size Audit ==="
echo ""

# --- Full build ---------------------------------------------------------------
echo "Building baseline (full)..."
output_full=$(bash scripts/build.sh 2>&1)
mv pramana "$BINARY_FULL"
size_full=$(get_size "$BINARY_FULL")
modules_full=$(echo "$output_full" | grep -o '[0-9]* modules' | grep -o '[0-9]*' || echo "?")

# --- MCP-stubbed build --------------------------------------------------------
echo "Building without @modelcontextprotocol/sdk..."
cp "$MCP_SERVER" "$MCP_BACKUP"
cat > "$MCP_SERVER" <<'STUB'
export type McpServerOptions = { port: number };
export async function startMcpServer(_opts: McpServerOptions): Promise<void> {
  process.exit(1);
}
STUB

output_stub=$(bash scripts/build.sh 2>&1)
mv pramana "$BINARY_STUB"
size_stub=$(get_size "$BINARY_STUB")
modules_stub=$(echo "$output_stub" | grep -o '[0-9]* modules' | grep -o '[0-9]*' || echo "?")

mv "$MCP_BACKUP" "$MCP_SERVER"

# --- Report -------------------------------------------------------------------
delta=$((size_full - size_stub))
module_delta=$((modules_full - modules_stub))
pct=$(printf "%.1f" "$(echo "$delta * 100 / $size_full" | bc -l)")

echo ""
echo "=== Results ==="
echo ""
printf "  %-35s %10s  %s modules\n" "Full binary" "$(format_bytes "$size_full")" "$modules_full"
printf "  %-35s %10s  %s modules\n" "Without MCP SDK" "$(format_bytes "$size_stub")" "$modules_stub"
echo "  ---"
printf "  %-35s %10s  %s modules (%s%%)\n" "MCP SDK contribution" "$(format_bytes "$delta")" "$module_delta" "$pct"
echo ""
echo "Bun $(bun --version) | $(uname -ms) | $(date -u +%Y-%m-%dT%H:%M:%SZ)"
