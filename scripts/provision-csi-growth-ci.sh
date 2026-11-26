#!/usr/bin/env bash
set -euo pipefail
# This profile deliberately uses a real loop-backed filesystem driver, not
# Kubernetes' metadata-only CSI test driver. It is a disposable CI evaluation.
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REPOSITORY:-}" = xad3play/vm_interface
sudo test -c /dev/kvm
sudo modprobe loop
sudo test -c /dev/loop-control
test "$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}' | wc -w)" -eq 1
test -z "$(kubectl get storageclass vm-expandable --ignore-not-found -o name)"
command -v helm
mkdir -p evidence
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --location --retry 3 --max-time 180 -o "$work/chart.tgz" https://github.com/openebs/rawfile-localpv/releases/download/v0.15.3/rawfile-localpv-0.15.3.tgz
echo "57da44022c61e8e6b08650c34308997fb06f48bc66f37afacf0fdcc61ee08bcb  $work/chart.tgz" | sha256sum -c -
cat > "$work/values.yaml" <<'YAML'
analytics:
  enabled: false
global:
  analytics:
    enabled: false
node:
  kubeletPath: /var/lib/kubelet
  storagePools:
    default:
      path: /var/local/openebs/rawfile/default-pool/
      reservedCapacity: "20%"
  snapshotController:
    enabled: false
capabilities:
  snapshots:
    enabled: false
  resize:
    enabled: true
crds:
  csi:
    volumeSnapshots:
      enabled: false
snapshotClasses: []
storageClasses:
  - name: vm-expandable
    enabled: true
    isDefault: false
    volumeBindingMode: WaitForFirstConsumer
    allowVolumeExpansion: true
    reclaimPolicy: Delete
    fsType: ext4
    thinProvision: "true"
    copyOnWrite: "false"
    freezeFs: "false"
    storagePool: default
YAML
helm install vm-csi "$work/chart.tgz" --namespace openebs --create-namespace -f "$work/values.yaml" --wait --timeout 10m
kubectl get storageclass vm-expandable -o json > evidence/csi-storageclass.json
python3 - <<'PY'
import json
s=json.load(open("evidence/csi-storageclass.json"))
assert s["provisioner"]=="rawfile.csi.openebs.io" and s["allowVolumeExpansion"] is True
PY
kubectl get csidriver rawfile.csi.openebs.io
# The default RBAC suite was verified before enabling this explicit profile.
kubectl apply --dry-run=server -f infra/storage-growth.yaml
kubectl apply -f infra/storage-growth.yaml
for i in $(seq 1 30); do
  kubectl get validatingadmissionpolicy vm-pvc-growth -o json > evidence/csi-admission.json
  if python3 - <<'PY'
import json,sys
s=json.load(open("evidence/csi-admission.json")).get("status",{})
if "typeChecking" not in s: sys.exit(1)
assert not s["typeChecking"].get("expressionWarnings"),s
PY
  then break; fi
  test "$i" -lt 30
  sleep 2
done
# An attempted resize of the local-path recording claim is rejected by
# Kubernetes' built-in storage admission before our policy can be evaluated.
# Test a normally valid metadata patch instead; require OUR policy's denial,
# not an unrelated storage-class error. Dry-run prevents a real mutation.
if kubectl --as=system:serviceaccount:vm-interface:vm-api -n vm-interface patch pvc vm-recordings --type=merge --dry-run=server -p '{"metadata":{"annotations":{"vm-interface.example/denial-probe":"true"}}}' >evidence/csi-denied-patch.txt 2>&1; then
  echo "Unexpected non-VM PVC patch permission" >&2
  exit 1
fi
cat evidence/csi-denied-patch.txt
grep -q 'vm-pvc-growth' evidence/csi-denied-patch.txt
# Patch both containers in one rollout; kubectl set env --containers accepts
# a name pattern, not a reliable comma-separated selection.
kubectl -n vm-interface patch deployment vm-api --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","env":[{"name":"VM_STORAGE_CLASS","value":"vm-expandable"}]},{"name":"reconcile","env":[{"name":"VM_STORAGE_CLASS","value":"vm-expandable"}]}]}}}}'
kubectl -n vm-interface rollout status deployment/vm-api --timeout=300s
kubectl -n vm-interface get deployment vm-api -o json | python3 -c 'import json,sys; c={x["name"]:x for x in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"]}; assert all(any(e["name"]=="VM_STORAGE_CLASS" and e.get("value")=="vm-expandable" for e in c[n].get("env",[])) for n in ("api","reconcile"))'
