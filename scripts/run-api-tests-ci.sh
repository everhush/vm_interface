#!/usr/bin/env bash
# One short-lived API port-forward per named test stage; preserve diagnostics.
set -euo pipefail
if [ "${VM_DISPOSABLE_DEVICE:-}" = true ]; then
  case "${GITHUB_RUN_ID:-}" in device-*) ;; *) echo 'Expected disposable device run identity' >&2; exit 1 ;; esac
else
  test "${GITHUB_REPOSITORY:-}" = xad3play/vm_interface
  test "${RUNNER_ENVIRONMENT:-}" = github-hosted
fi
test "$#" -gt 0
mkdir -p evidence
export API_URL=http://127.0.0.1:3000/api/v1
export VNC_URL=wss://127.0.0.1:3443/api/v1
export CONSOLE_CA_PATH="${CONSOLE_CA_PATH:-/tmp/console-tls.crt}"
test -r "$CONSOLE_CA_PATH"
# This host is already authorized and disposable. Route only to the service's
# private ClusterIP; retain loopback-only client ports and end-to-end WSS TLS.
service_json="$(mktemp)"
kubectl -n vm-interface get svc vm-api -o json >"$service_json"
node scripts/ci_loopback_relay.ts --service-json "$service_json" >>evidence/api-relay.log 2>&1 &
relay_pid=$!
bash scripts/watch-launcher-ci.sh &
diag_pid=$!
cleanup() {
  kill "$relay_pid" "$diag_pid" 2>/dev/null || true
  wait "$relay_pid" "$diag_pid" 2>/dev/null || true
  rm -f "$service_json"
}
trap cleanup EXIT
curl --retry 20 --retry-delay 2 --retry-connrefused --fail http://127.0.0.1:3000/api/v1/health
# TLS listener must be actually reachable and certificate-verified before clients run.
test "$(curl -sS --cacert "$CONSOLE_CA_PATH" --retry 20 --retry-delay 2 --retry-connrefused -o /dev/null -w '%{http_code}' https://127.0.0.1:3443/)" = 404
printf '%s START %s\n' "$(date -u +%FT%TZ)" "$*" >>evidence/api-test-stages.txt
rc=0
"$@" || rc=$?
printf '%s END rc=%s %s\n' "$(date -u +%FT%TZ)" "$rc" "$*" >>evidence/api-test-stages.txt
exit "$rc"
