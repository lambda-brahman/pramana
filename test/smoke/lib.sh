# Shared helpers for smoke tests. Source this file.
# Each test script exits 0 on pass, non-zero on fail; writes human output to stdout.

: "${PRAMANA_BIN:=pramana}"
: "${PRAMANA_PORT:=5111}"
: "${PRAMANA_HOST:=http://localhost:${PRAMANA_PORT}}"
: "${PRAMANA_CONFIG:=$HOME/.pramana/config.json}"

# A tenant known to be live with >=1 artifact. Override for CI.
: "${SMOKE_LIVE_TENANT:=ggo-learned}"
# A tenant entry whose source path intentionally does not exist.
# Used to regression-test dead-tenant recovery. Override for CI.
: "${SMOKE_DEAD_TENANT:=kastrup}"

_pass() { printf "  ok    %s\n" "$1"; }
_fail() { printf "  FAIL  %s — %s\n" "$1" "$2" >&2; exit 1; }
_skip() { printf "  skip  %s — %s\n" "$1" "$2"; exit 77; }

http_code() { curl -sS -m 3 -o /dev/null -w "%{http_code}" "$1"; }
http_body() { curl -sS -m 3 "$1"; }
