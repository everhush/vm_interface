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
node -e 'const s=JSON.parse(require("node:fs").readFileSync("evidence/csi-storageclass.json","utf8"));require("node:assert/strict")(s.provisioner==="rawfile.csi.openebs.io"&&s.allowVolumeExpansion===true)'
kubectl get csidriver rawfile.csi.openebs.io
# The default RBAC suite was verified before enabling this explicit profile.
kubectl apply --dry-run=server -f infra/storage-growth.yaml
kubectl apply -f infra/storage-growth.yaml
for i in $(seq 1 30); do
  kubectl get validatingadmissionpolicy vm-pvc-growth -o json > evidence/csi-admission.json
  if node -e 'const s=JSON.parse(require("node:fs").readFileSync("evidence/csi-admission.json","utf8")).status??{};require("node:assert/strict")(s.typeChecking&&!s.typeChecking.expressionWarnings?.length)'
  then break; fi
  test "$i" -lt 30
  sleep 2
done
# CEL type checking is not proof that admission caches have converged.
# Before granting broad patch permission, allow this identity to patch ONLY
# a harmless disposable sentinel. All probes are server-side dry-run.
kubectl apply -f - <<'YAML'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: vm-growth-admission-sentinel
  namespace: vm-interface
spec:
  storageClassName: local-path
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Mi
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: vm-growth-admission-sentinel
  namespace: vm-interface
rules:
- apiGroups: [""]
  resources: ["persistentvolumeclaims"]
  resourceNames: ["vm-growth-admission-sentinel"]
  verbs: ["get", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: vm-growth-admission-sentinel
  namespace: vm-interface
subjects:
- kind: ServiceAccount
  name: vm-api
  namespace: vm-interface
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: vm-growth-admission-sentinel
YAML
cleanup_probe() {
  kubectl -n vm-interface delete rolebinding,role,pvc vm-growth-admission-sentinel --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
cleanup() {
  cleanup_probe
  if [ "${growth_ready:-false}" != true ]; then
    kubectl delete -f infra/storage-growth-rbac.yaml --ignore-not-found --wait=false >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT
probe() {
  if kubectl --as=system:serviceaccount:vm-interface:vm-api -n vm-interface patch pvc "$1" --type=merge --dry-run=server -p '{"metadata":{"annotations":{"vm-interface.example/denial-probe":"true"}}}' >"$2" 2>&1; then
    return 1
  fi
  grep -q 'vm-pvc-growth' "$2" && grep -q 'Only an existing owner-bound managed PVC may grow' "$2"
}
for i in $(seq 1 30); do
  if probe vm-growth-admission-sentinel evidence/csi-admission-readiness.txt; then break; fi
  test "$i" -lt 30 || { cat evidence/csi-admission-readiness.txt >&2; exit 1; }
  sleep 2
done
cat evidence/csi-admission-readiness.txt
cleanup_probe
kubectl apply --dry-run=server -f infra/storage-growth-rbac.yaml
kubectl apply -f infra/storage-growth-rbac.yaml
for i in $(seq 1 30); do
  if probe vm-recordings evidence/csi-denied-patch.txt; then break; fi
  test "$i" -lt 30 || { cat evidence/csi-denied-patch.txt >&2; exit 1; }
  sleep 2
done
cat evidence/csi-denied-patch.txt
# Patch both containers in one rollout; kubectl set env --containers accepts
# a name pattern, not a reliable comma-separated selection.
kubectl -n vm-interface patch deployment vm-api --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","env":[{"name":"VM_STORAGE_CLASS","value":"vm-expandable"}]},{"name":"reconcile","env":[{"name":"VM_STORAGE_CLASS","value":"vm-expandable"}]}]}}}}'
kubectl -n vm-interface rollout status deployment/vm-api --timeout=300s
kubectl -n vm-interface get deployment vm-api -o json | node -e 'const c=JSON.parse(require("node:fs").readFileSync(0,"utf8")).spec.template.spec.containers;require("node:assert/strict")(["api","reconcile"].every(n=>c.find(x=>x.name===n)?.env?.some(e=>e.name==="VM_STORAGE_CLASS"&&e.value==="vm-expandable")))'

growth_ready=true
