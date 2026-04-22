#!/usr/bin/env bash
set -u
. "$(dirname "$0")/../lib.sh"

# doctor exits non-zero when it finds issues. We don't assert clean — we only
# assert it runs, produces output, and doesn't hang/crash.
out=$("$PRAMANA_BIN" doctor 2>&1)
rc=$?
[[ -n "$out" ]] || _fail doctor-no-output "doctor produced no output"
[[ $rc -ne 127 && $rc -ne 139 ]] || _fail doctor-crashed "doctor crashed (rc=$rc)"
_pass "doctor ran (rc=$rc, $(echo "$out" | wc -l | tr -d ' ') lines)"
