#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile="${1:-}"
if [ "$profile" = checks ]; then
  test "$(node -p 'process.versions.node.split(".")[0]')" = 24
  command -v ffmpeg >/dev/null
  command -v tesseract >/dev/null
  npm ci --no-audit --no-fund
  npm run typecheck
  npm run lint
  npm test
  npm run build
  python3 -m compileall -q scripts
  python3 -m unittest discover -s scripts -p 'test_*.py'
  python3 -m unittest discover -s showcases/windows -p 'test_*.py'
  for f in scripts/*.sh showcases/android/*.sh; do bash -n "$f"; done
  exit 0
fi
case "$profile" in
  core|windows) architecture=amd64 ;;
  android) architecture=arm64 ;;
  *) echo 'Usage: bash scripts/device-validate.sh checks | {core|windows|android} --confirm-disposable [showcase args...]' >&2; exit 2 ;;
esac
test "${2:-}" = --confirm-disposable
shift 2
# This provisions a new K3s cluster and uses local disks. Never use a personal
# workstation, existing cluster, persistent shared runner or unreviewed checkout.
test -z "$(git status --porcelain --untracked-files=no)"
if [ -d evidence ] && [ -n "$(find evidence -mindepth 1 -print -quit)" ]; then echo "Move existing evidence aside before a fresh run" >&2; exit 1; fi
test ! -e /etc/rancher/k3s/k3s.yaml
test ! -e "$HOME/.kube/config"
test -z "${KUBECONFIG:-}"
for cmd in docker node npm python3 curl openssl tesseract ffmpeg ffprobe git skopeo; do command -v "$cmd" >/dev/null; done
mkdir -p evidence
if [ "$profile" = core ]; then
  sudo python3 scripts/device-preflight.py --architecture "$architecture" | tee evidence/device-preflight.json
else
  sudo python3 scripts/device-preflight.py --architecture "$architecture" --large-media | tee evidence/device-preflight.json
  test "$#" -gt 0
  python3 scripts/showcase-native.py "$profile" "$@" --preflight-only | tee evidence/showcase-input-preflight.json
fi
bash scripts/device-validate.sh checks
export VM_DISPOSABLE_DEVICE=true
# Old provisioning probes require the CI flag; this is a local disposable
# validation execution, not a claim that GitHub Actions has run it.
export GITHUB_ACTIONS=true
export GITHUB_SHA="$(git rev-parse HEAD)" GITHUB_RUN_ID="device-$(date -u +%Y%m%dT%H%M%SZ)-$$"
bash scripts/provision-ci.sh
docker build -t vm-interface:ci .
docker save vm-interface:ci | sudo k3s ctr images import -
export TOKEN_A="$(openssl rand -hex 32)" TOKEN_B="$(openssl rand -hex 32)"
kubectl -n vm-interface create secret generic vm-api-test --from-literal=identities="{\"alpha\":\"$TOKEN_A\",\"beta\":\"$TOKEN_B\"}"
tls=$(mktemp -d); port_pid=""; diag_pid=""
cleanup() {
  if [ -n "$port_pid" ]; then kill "$port_pid" 2>/dev/null || true; fi
  if [ -n "$diag_pid" ]; then kill "$diag_pid" 2>/dev/null || true; fi
  rm -rf "$tls"
  unset TOKEN_A TOKEN_B
  echo 'Dedicated cluster retained for inspection. Operator owns disposal.'
}
trap cleanup EXIT
umask 077
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout "$tls/key" -out "$tls/ca"
kubectl -n vm-interface create secret tls vm-console-tls --key="$tls/key" --cert="$tls/ca"
rm -f "$tls/key"
chmod 644 "$tls/ca"
kubectl apply -f infra/app.yaml
if [ "$profile" != core ]; then
  kubectl -n vm-interface set env deployment/vm-api --containers=api,reconcile VM_MEDIA_MAX_MIB=8192 VM_MEDIA_STAGE_MAX_MIB=16384 VM_SYSTEM_MAX_GIB=64 VM_ACCOUNT_STORAGE_GIB=128 VM_ENABLE_GUEST_EXCHANGE_EVALUATION=true
  if [ "$profile" = android ]; then
    kubectl -n vm-interface set env deployment/vm-api --containers=api VM_ENABLE_ARM64_EVALUATION=true
  fi
fi
kubectl -n vm-interface rollout status deployment/vm-api --timeout=300s
python3 scripts/check-rbac-ci.py
start_port() {
  kubectl -n vm-interface port-forward svc/vm-api 3000:3000 3443:3443 >"$tls/port.log" 2>&1 &
  port_pid=$!
  curl --retry 20 --retry-delay 2 --retry-connrefused --fail http://127.0.0.1:3000/api/v1/health
}
export API_URL=http://127.0.0.1:3000/api/v1 VNC_URL=wss://127.0.0.1:3443/api/v1 CONSOLE_CA_PATH="$tls/ca"
start_port
bash scripts/watch-launcher-ci.sh & diag_pid=$!
if [ "$profile" = core ]; then
  python3 scripts/e2e-smoke.py
  python3 scripts/e2e-persistent.py
  python3 scripts/e2e-data-disks.py
  node --import tsx scripts/e2e-vnc.ts
  python3 scripts/e2e-api-control-proof.py
  node --import tsx scripts/e2e-input.ts
  docker run --rm --network host --user "$(id -u):$(id -g)" -e TOKEN_A -e TOKEN_B -v "$PWD/evidence:/app/evidence" vm-interface:ci node --import tsx scripts/e2e-recording.ts
  python3 scripts/e2e-exchange.py
  python3 scripts/e2e-api-functional-proof.py
  node --import tsx scripts/e2e-network.ts
  python3 scripts/e2e-idle.py
  bash scripts/e2e-media-ci.sh
  bash scripts/e2e-iso-ci.sh
  python3 scripts/e2e-recovery.py before
  kill "$port_pid" 2>/dev/null || true; port_pid=""
  kubectl -n vm-interface rollout restart deployment/vm-api
  kubectl -n vm-interface rollout status deployment/vm-api --timeout=300s
  start_port
  python3 scripts/e2e-recovery.py after
  python3 scripts/probe-virtiofs-ci.py
else
  python3 scripts/showcase-native.py "$profile" "$@"
fi
python3 scripts/verify-evidence.py --root evidence --profile "$profile" | tee evidence/device-evidence-verification.json
printf '%s\n' "$GITHUB_SHA" > evidence/device-commit.txt
printf '%s\n' "$GITHUB_RUN_ID" > evidence/device-run-id.txt
echo 'Selected device workflow passed; independent artifact review remains mandatory.'
