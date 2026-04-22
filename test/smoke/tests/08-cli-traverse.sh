#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

slug=$("$PRAMANA_BIN" list --tenant "$SMOKE_LIVE_TENANT" 2>/dev/null | jq -r '.[0].slug')
[[ -n "$slug" && "$slug" != "null" ]] || _fail pick-slug "couldn't pick a slug from list"

out=$("$PRAMANA_BIN" traverse "$slug" --depth 1 --tenant "$SMOKE_LIVE_TENANT" 2>&1) \
  || _fail traverse-exit "traverse exited non-zero: $out"
echo "$out" | jq -e 'type=="array" or type=="object"' >/dev/null \
  || _fail traverse-json "unexpected shape: $(echo "$out" | head -c 120)"
_pass "traverse from '$slug' depth=1 returned valid JSON"
