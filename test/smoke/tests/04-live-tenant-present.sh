#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

body=$(http_body "$PRAMANA_HOST/v1/tenants")
echo "$body" | jq -e --arg t "$SMOKE_LIVE_TENANT" '.[] | select(.name==$t)' >/dev/null \
  || _fail live-tenant-in-runtime "tenant '$SMOKE_LIVE_TENANT' not served; got: $body"

count=$(echo "$body" | jq -r --arg t "$SMOKE_LIVE_TENANT" '.[] | select(.name==$t) | .artifactCount')
(( count > 0 )) || _fail live-tenant-has-artifacts "'$SMOKE_LIVE_TENANT' ingested 0 artifacts"
_pass "'$SMOKE_LIVE_TENANT' live with $count artifact(s)"
