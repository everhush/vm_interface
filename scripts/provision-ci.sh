#!/usr/bin/env bash
set -euo pipefail
# Disposable hosted runner only; never run against an existing cluster.
if [ "${GITHUB_ACTIONS:-}" != true ] && [ "${VM_DISPOSABLE_DEVICE:-}" != true ]; then echo "Disposable CI/device required" >&2; exit 1; fi
case "$(uname -m)" in x86_64|aarch64) ;; *) exit 1;; esac
if [ -e /etc/rancher/k3s/k3s.yaml ] || [ -e "$HOME/.kube/config" ]; then echo "Refusing to modify an existing cluster/configuration" >&2; exit 1; fi
sudo test -c /dev/kvm
sudo modprobe kvm || true
mkdir -p evidence
sources=$(mktemp -d)
trap 'rm -rf "$sources"' EXIT
python3 scripts/provision_sources.py --directory "$sources" --evidence evidence/provision-sources.json
case "$(uname -m)" in x86_64) binary=k3s-amd64 ;; aarch64) binary=k3s-arm64 ;; *) exit 1 ;; esac
sudo install -m 0755 "$sources/$binary" /usr/local/bin/k3s
export INSTALL_K3S_VERSION='v1.34.13+k3s1'
# Skip only the binary download; keep supported installer SELinux handling.
sudo env INSTALL_K3S_SKIP_DOWNLOAD=binary INSTALL_K3S_BIN_DIR=/usr/local/bin INSTALL_K3S_VERSION="$INSTALL_K3S_VERSION" INSTALL_K3S_EXEC="server --disable traefik --disable servicelb --write-kubeconfig-mode 600" sh "$sources/install.sh"
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
chmod 600 "$HOME/.kube/config"
# A successful systemd start does not imply kubelet node registration.
# An empty list makes kubectl wait --all exit immediately rather than wait.
registered=false
for attempt in $(seq 1 60); do
  if [ -n "$(kubectl get nodes -o name --request-timeout=5s 2>/dev/null || true)" ]; then
    registered=true
    break
  fi
  sleep 3
done
if [ "$registered" != true ]; then
  sudo journalctl -u k3s --no-pager -n 100 >&2
  echo "No node registered within 180 seconds" >&2
  exit 1
fi
kubectl wait node --all --for=condition=Ready --timeout=180s
# CRD creation is asynchronous. Establishment and actual discovery must
# precede the first custom resource apply (fresh API servers can race).
await_crd() {
  kubectl wait --for=condition=Established "crd/$1" --timeout=180s
  for attempt in $(seq 1 60); do
    if kubectl get --raw "$2" --request-timeout=5s >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "CRD API discovery unavailable: $1 ($2)" >&2
  return 1
}
kubectl apply -f "$sources/kubevirt-operator.yaml"
await_crd kubevirts.kubevirt.io /apis/kubevirt.io/v1
kubectl apply -f "$sources/kubevirt-cr.yaml"
# KubeVirt 1.9 enables ImageVolume by default; K3s 1.34/containerd 2.2
# cannot mount the helper image reliably. Retain the standard init-container
# path until the pinned runtime supports native image volumes.
# https://github.com/kubevirt/kubevirt/issues/17460
# https://github.com/cozystack/cozystack/issues/3190
kubectl -n kubevirt patch kubevirt kubevirt --type=merge -p '{"spec":{"configuration":{"developerConfiguration":{"featureGates":["EnableVirtioFsStorageVolumes"],"disabledFeatureGates":["ImageVolume"]}}}}'
kubectl -n kubevirt wait kubevirt kubevirt --for=condition=Available --timeout=600s
kubectl -n kubevirt rollout status deployment/virt-controller --timeout=300s
kubectl -n kubevirt rollout status daemonset/virt-handler --timeout=300s
kubectl -n kubevirt get kubevirt kubevirt -o jsonpath='{.spec.configuration.developerConfiguration.disabledFeatureGates}' | grep -q ImageVolume
# Prove actual KVM capacity is published; no software-emulation fallback.
mkdir -p evidence
# Node labels/device publication may lag behind the handler rollout.
for attempt in $(seq 1 30); do
  if kubectl get nodes -o json | python3 scripts/kvm_capacity.py > evidence/kvm-capacity.json; then
    cat evidence/kvm-capacity.json
    break
  fi
  if [ "$attempt" = 30 ]; then exit 1; fi
  sleep 2
done

kubectl apply -f "$sources/cdi-operator.yaml"
await_crd cdis.cdi.kubevirt.io /apis/cdi.kubevirt.io/v1beta1
kubectl apply -f "$sources/cdi-cr.yaml"
kubectl wait cdi cdi --for=condition=Available --timeout=600s
kubectl apply --server-side -f "$sources/cnpg.yaml"
await_crd clusters.postgresql.cnpg.io /apis/postgresql.cnpg.io/v1
kubectl -n cnpg-system rollout status deployment/cnpg-controller-manager --timeout=300s
python3 scripts/device_profile.py namespace "${VM_DEVICE_PROFILE:-core}" | kubectl apply -f -
kubectl apply -f infra/exchange-policy.yaml
kubectl apply -f infra/disk-export-policy.yaml
kubectl -n vm-interface wait cluster vm-db --for=condition=Ready --timeout=600s
