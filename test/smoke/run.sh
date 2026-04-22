#!/usr/bin/env bash
# Pramana smoke-test runner.
#
# Usage:
#   test/smoke/run.sh             # run all tests, pretty output
#   test/smoke/run.sh --json      # machine-readable per-test results
#   test/smoke/run.sh t/05*.sh    # run a subset
#
# Exit codes: 0 all pass, 1 any failure, 2 runner error.

set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

json=false
[[ "${1:-}" == "--json" ]] && { json=true; shift; }

files=()
if [[ $# -gt 0 ]]; then
  files=( "$@" )
else
  while IFS= read -r line; do files+=( "$line" ); done < <(ls tests/*.sh | sort)
fi

pass=0; fail=0; skip=0
$json || printf "\npramana smoke — %d tests\n\n" "${#files[@]}"
results_json="["

for f in "${files[@]}"; do
  name="$(basename "$f" .sh)"
  $json || printf "• %s\n" "$name"
  out=$(bash "$f" 2>&1)
  code=$?
  case $code in
    0)  pass=$((pass+1)); status="pass" ;;
    77) skip=$((skip+1)); status="skip" ;;
    *)  fail=$((fail+1)); status="fail" ;;
  esac
  if $json; then
    esc=$(printf '%s' "$out" | jq -Rs .)
    results_json+="{\"test\":\"$name\",\"status\":\"$status\",\"code\":$code,\"output\":$esc},"
  else
    [[ -n "$out" ]] && printf "%s\n" "$out"
  fi
done

results_json="${results_json%,}]"

if $json; then
  jq -n --argjson r "$results_json" --arg pass "$pass" --arg fail "$fail" --arg skip "$skip" \
    '{summary:{pass:($pass|tonumber),fail:($fail|tonumber),skip:($skip|tonumber)},results:$r}'
else
  printf "\n%d pass, %d fail, %d skip\n" "$pass" "$fail" "$skip"
fi

[[ $fail -eq 0 ]] || exit 1
exit 0
