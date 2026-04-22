#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

[[ -f "$PRAMANA_CONFIG" ]] || _fail config-exists "$PRAMANA_CONFIG missing"
jq . "$PRAMANA_CONFIG" >/dev/null 2>&1 || _fail config-valid-json "config is not valid JSON"
_pass "config valid JSON at $PRAMANA_CONFIG"

version=$(jq -r '.version' "$PRAMANA_CONFIG")
[[ "$version" != "null" ]] || _fail config-version "missing .version"
_pass "config schema version: $version"

count=$(jq -r '.tenants | length' "$PRAMANA_CONFIG")
(( count > 0 )) || _fail config-has-tenants "no tenants configured"
_pass "$count tenants configured"
