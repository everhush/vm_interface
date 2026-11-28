#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile="${1:-}"
if [ "$profile" = checks ]; then
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major!==24||minor<11)throw new Error("Node 24.11+ required")'
  command -v ffmpeg >/dev/null
  command -v tesseract >/dev/null
  npm ci --no-audit --no-fund
  npm run check
  if [ -n "${VM_STATIC_TEST_REPORT:-}" ]; then
    test_report="$VM_STATIC_TEST_REPORT"
    test ! -e "$test_report"
  else
    test_report=$(mktemp -t vm-interface-tests.XXXXXX.json)
    trap 'rm -f "$test_report"' EXIT
  fi
  npm test -- --reporter=json --outputFile="$test_report"
  node scripts/verify-static-test-report.ts "$test_report"
  npm run build
  node scripts/check-source-migration.ts
  NODE_DISABLE_COMPILE_CACHE=1 node --import tsx --input-type=module -e 'await import("./src/exchange.ts"); await import("./scripts/android-guest-transfer.ts");'
  for f in scripts/*.sh showcases/android/*.sh; do bash -n "$f"; done
  exit 0
fi
case "$profile" in
  core|linux|windows) architecture=amd64 ;;
  android) architecture=arm64 ;;
  *) echo 'Usage: bash scripts/device-validate.sh checks | {core|linux|windows|android} --confirm-disposable [showcase args...]' >&2; exit 2 ;;
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
for cmd in buildah node npm cc curl openssl tesseract ffmpeg ffprobe git skopeo; do command -v "$cmd" >/dev/null; done
mkdir -p evidence
if [ "$profile" = core ] || [ "$profile" = linux ]; then
  test "$#" -eq 0
  sudo "$(command -v node)" scripts/device-preflight.ts --architecture "$architecture" | tee evidence/device-preflight.json
else
  sudo "$(command -v node)" scripts/device-preflight.ts --architecture "$architecture" --large-media | tee evidence/device-preflight.json
  test "$#" -gt 0
  node scripts/showcase-native.ts "$profile" "$@" --preflight-only | tee evidence/showcase-input-preflight.json
fi
bash scripts/device-validate.sh checks
export VM_DISPOSABLE_DEVICE=true VM_DEVICE_PROFILE="$profile"
# Old provisioning probes require the CI flag; this is a local disposable
# validation execution, not a claim that GitHub Actions has run it.
export GITHUB_ACTIONS=true
export GITHUB_SHA="$(git rev-parse HEAD)" GITHUB_RUN_ID="device-$(date -u +%Y%m%dT%H%M%SZ)-$$"
bash scripts/provision-ci.sh
bash scripts/build-oci.sh k3s
export TOKEN_A="$(openssl rand -hex 32)" TOKEN_B="$(openssl rand -hex 32)"
kubectl -n vm-interface create secret generic vm-api-test --from-literal=identities="{\"alpha\":\"$TOKEN_A\",\"beta\":\"$TOKEN_B\"}"
kubectl -n vm-interface create secret generic vm-api-export --from-literal=token="$(openssl rand -hex 32)"
tls=$(mktemp -d)
cleanup() {
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
if [ "$profile" = windows ] || [ "$profile" = android ]; then
  kubectl -n vm-interface patch deployment vm-api --type=strategic -p "$(node scripts/device_profile.ts deployment "$profile")"
  kubectl -n vm-interface get deployment vm-api -o json | node scripts/device_profile.ts verify-deployment "$profile"
  kubectl -n vm-interface get pvc vm-media-stage -o json | node scripts/device_profile.ts verify-pvc "$profile"
fi
kubectl -n vm-interface rollout status deployment/vm-api --timeout=300s
node scripts/check-rbac-ci.ts
export CONSOLE_CA_PATH="$tls/ca" RECOVERY_STATE_PATH="$tls/recovery.json"
stage() { bash scripts/run-api-tests-ci.sh "$@"; }
if [ "$profile" = core ]; then
  stage node scripts/e2e-smoke.ts
  stage node scripts/e2e-persistent.ts
  stage node scripts/e2e-data-disks.ts
  stage node --import tsx scripts/e2e-vnc.ts
  stage node scripts/e2e-api-control-proof.ts
  stage node --import tsx scripts/e2e-input.ts
  stage node --import tsx scripts/e2e-network.ts
  node scripts/verify_network_evidence.ts --root evidence --commit "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID" | tee evidence/network-independent-verification.json
  stage node --import tsx scripts/e2e-recording.ts
  stage node scripts/e2e-exchange.ts
  stage node scripts/e2e-api-functional-proof.ts
  stage node scripts/e2e-idle.ts
  stage bash scripts/e2e-media-ci.sh
  node scripts/verify_media_evidence.ts --root evidence --commit "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID" | tee evidence/media-evidence-verification.json
  stage bash scripts/e2e-iso-ci.sh
  stage node scripts/e2e-recovery.ts before
  kubectl -n vm-interface rollout restart deployment/vm-api
  kubectl -n vm-interface rollout status deployment/vm-api --timeout=300s
  stage node scripts/e2e-recovery.ts after
  node scripts/probe-virtiofs-ci.ts
elif [ "$profile" = linux ]; then
  stage node scripts/e2e-api-functional-proof.ts
else
  stage node scripts/showcase-native.ts "$profile" "$@"
fi
node scripts/verify-evidence.ts --root evidence --profile "$profile" --commit "$GITHUB_SHA" | tee evidence/device-evidence-verification.json
printf '%s\n' "$GITHUB_SHA" > evidence/device-commit.txt
printf '%s\n' "$GITHUB_RUN_ID" > evidence/device-run-id.txt
echo 'Selected device workflow passed; independent artifact review remains mandatory.'
