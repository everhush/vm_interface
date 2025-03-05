#!/usr/bin/env bash
set -euo pipefail
# Disposable hosted runner only; never run against an existing cluster.
test "${GITHUB_ACTIONS:-}" = true
test "$(uname -m)" = x86_64
sudo test -c /dev/kvm
sudo modprobe kvm || true
export INSTALL_K3S_VERSION='v1.34.13+k3s1'
curl --fail --location --retry 3 https://get.k3s.io | sudo env INSTALL_K3S_VERSION="$INSTALL_K3S_VERSION" INSTALL_K3S_EXEC="server --disable traefik --disable servicelb --write-kubeconfig-mode 600" sh -
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
chmod 600 "$HOME/.kube/config"
kubectl wait node --all --for=condition=Ready --timeout=180s
KV=v1.9.0
CDI=v1.66.0
kubectl apply -f "https://github.com/kubevirt/kubevirt/releases/download/$KV/kubevirt-operator.yaml"
kubectl apply -f "https://github.com/kubevirt/kubevirt/releases/download/$KV/kubevirt-cr.yaml"
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

kubectl apply -f "https://github.com/kubevirt/containerized-data-importer/releases/download/$CDI/cdi-operator.yaml"
kubectl apply -f "https://github.com/kubevirt/containerized-data-importer/releases/download/$CDI/cdi-cr.yaml"
kubectl wait cdi cdi --for=condition=Available --timeout=600s
kubectl apply --server-side -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/v1.30.0/releases/cnpg-1.30.0.yaml
kubectl -n cnpg-system rollout status deployment/cnpg-controller-manager --timeout=300s
kubectl apply -f infra/namespace.yaml
kubectl apply -f infra/exchange-policy.yaml
kubectl -n vm-interface wait cluster vm-db --for=condition=Ready --timeout=600s
