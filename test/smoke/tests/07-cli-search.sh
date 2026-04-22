#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

# Search should return a JSON array. We don't assert non-empty — corpus may not match.
out=$("$PRAMANA_BIN" search "pattern" --tenant "$SMOKE_LIVE_TENANT" 2>&1) \
  || _fail search-exit "search exited non-zero: $out"
echo "$out" | jq -e 'type=="array"' >/dev/null \
  || _fail search-json "search output is not a JSON array: $(echo "$out" | head -c 120)"
_pass "search returned valid JSON array ($(echo "$out" | jq length) hit(s))"
