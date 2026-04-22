#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

# Precondition: SMOKE_DEAD_TENANT must be in config and point to a nonexistent path.
in_config=$(jq -r --arg t "$SMOKE_DEAD_TENANT" '.tenants[$t] // empty' "$PRAMANA_CONFIG")
[[ -n "$in_config" ]] || _skip dead-tenant-configured "'$SMOKE_DEAD_TENANT' not in config — nothing to test"
[[ ! -e "$in_config" ]] || _skip dead-tenant-path-exists "'$SMOKE_DEAD_TENANT' path actually exists: $in_config"

# 1) Daemon must NOT expose the dead tenant.
body=$(http_body "$PRAMANA_HOST/v1/tenants")
echo "$body" | jq -e --arg t "$SMOKE_DEAD_TENANT" 'all(.name != $t)' >/dev/null \
  || _fail dead-tenant-not-served "dead tenant is being served — expected to be skipped"
_pass "dead tenant '$SMOKE_DEAD_TENANT' not served (graceful skip)"

# 2) Live tenants still work.
code=$(http_code "$PRAMANA_HOST/v1/tenants")
[[ "$code" == "200" ]] || _fail daemon-still-healthy "daemon not healthy after dead tenant — got $code"
_pass "daemon still healthy with dead tenant in config"

# 3) CLI against the dead tenant must return a clean error (not crash, not hang).
out=$("$PRAMANA_BIN" list --tenant "$SMOKE_DEAD_TENANT" 2>&1)
rc=$?
(( rc != 0 )) || _fail dead-tenant-cli-exit "CLI should exit non-zero on dead tenant"
[[ "$out" == *"not found"* ]] || _fail dead-tenant-cli-msg "expected 'not found' message, got: $out"
_pass "CLI on dead tenant: clean error, exit=$rc"
