#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

out=$("$PRAMANA_BIN" list --tenant "$SMOKE_LIVE_TENANT" 2>&1) \
  || _fail list-exit "list exited non-zero: $out"
echo "$out" | jq -e 'type=="array"' >/dev/null \
  || _fail list-json "output is not a JSON array: $(echo "$out" | head -c 120)"
len=$(echo "$out" | jq -r 'length')
(( len > 0 )) || _fail list-nonempty "list returned empty for '$SMOKE_LIVE_TENANT'"
_pass "list returned $len artifact(s) from '$SMOKE_LIVE_TENANT'"
