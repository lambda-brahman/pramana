#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

code=$(http_code "$PRAMANA_HOST/v1/version")
[[ "$code" == "200" ]] || _fail version-endpoint "GET /v1/version -> $code (is the daemon running? pramana serve)"
body=$(http_body "$PRAMANA_HOST/v1/version")
ver=$(echo "$body" | jq -r '.version' 2>/dev/null)
[[ -n "$ver" && "$ver" != "null" ]] || _fail version-body "unexpected: $body"
_pass "daemon serves /v1/version — $ver"

code=$(http_code "$PRAMANA_HOST/v1/tenants")
[[ "$code" == "200" ]] || _fail tenants-endpoint "GET /v1/tenants -> $code"
_pass "daemon serves /v1/tenants"
