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
# Separate HTTP/WSS transports; restart only transport, not API mutations.
supervise_port() {
  local child=""
  trap 'if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; exit 0' TERM INT
  while true; do
    kubectl -n vm-interface port-forward --address 127.0.0.1 svc/vm-api "$1" >>evidence/api-port-forward.log 2>&1 &
    child=$!
    wait "$child" || true
    child=""
    sleep 1
  done
}
supervise_port 3000:3000 &
port_pid=$!
supervise_port 3443:3443 &
wss_pid=$!
bash scripts/watch-launcher-ci.sh &
diag_pid=$!
cleanup() {
  kill "$port_pid" "$wss_pid" "$diag_pid" 2>/dev/null || true
  wait "$port_pid" "$wss_pid" "$diag_pid" 2>/dev/null || true
}
trap cleanup EXIT
curl --retry 20 --retry-delay 2 --retry-connrefused --fail http://127.0.0.1:3000/api/v1/health
printf '%s START %s\n' "$(date -u +%FT%TZ)" "$*" >>evidence/api-test-stages.txt
rc=0
"$@" || rc=$?
printf '%s END rc=%s %s\n' "$(date -u +%FT%TZ)" "$rc" "$*" >>evidence/api-test-stages.txt
exit "$rc"
