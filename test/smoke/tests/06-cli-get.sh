#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

slug=$("$PRAMANA_BIN" list --tenant "$SMOKE_LIVE_TENANT" 2>/dev/null | jq -r '.[0].slug')
[[ -n "$slug" && "$slug" != "null" ]] || _fail pick-slug "couldn't pick a slug from list"

out=$("$PRAMANA_BIN" get "$slug" --tenant "$SMOKE_LIVE_TENANT" 2>&1) \
  || _fail get-exit "get exited non-zero: $out"
echo "$out" | jq -e --arg s "$slug" '.slug==$s' >/dev/null \
  || _fail get-roundtrip "get($slug) did not return matching slug"
_pass "get roundtrip on '$slug'"
