#!/usr/bin/env bash
# One short-lived API port-forward per named test stage; preserve diagnostics.
set -euo pipefail
test "${GITHUB_REPOSITORY:-}" = xad3play/vm_interface
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "$#" -gt 0
mkdir -p evidence
export API_URL=http://127.0.0.1:3000/api/v1
export VNC_URL=wss://127.0.0.1:3443/api/v1
export CONSOLE_CA_PATH=/tmp/console-tls.crt
kubectl -n vm-interface port-forward svc/vm-api 3000:3000 3443:3443 >>evidence/api-port-forward.log 2>&1 &
port_pid=$!
bash scripts/watch-launcher-ci.sh &
diag_pid=$!
cleanup() {
  kill "$port_pid" "$diag_pid" 2>/dev/null || true
  wait "$port_pid" "$diag_pid" 2>/dev/null || true
}
trap cleanup EXIT
curl --retry 20 --retry-delay 2 --retry-connrefused --fail http://127.0.0.1:3000/api/v1/health
printf '%s START %s\n' "$(date -u +%FT%TZ)" "$*" >>evidence/api-test-stages.txt
rc=0
"$@" || rc=$?
printf '%s END rc=%s %s\n' "$(date -u +%FT%TZ)" "$rc" "$*" >>evidence/api-test-stages.txt
exit "$rc"
