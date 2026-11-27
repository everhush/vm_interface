# Managed Kubernetes evaluation deployment

K3s on a clean local device remains the native evaluation profile. EKS and AKS are candidate remote Kubernetes platforms, not a separate VM backend. Use an authorized **dedicated evaluation cluster** and explicit kubeconfig context. Do not provision paid resources automatically or install these cluster-scoped admission policies on a shared cluster.

## Required infrastructure

- Kubernetes API supporting stable ValidatingAdmissionPolicy, real Linux KVM-capable workers with `devices.kubevirt.io/kvm` and `kubevirt.io/schedulable=true`; managed control plane alone is not evidence of nested virtualization. Never use software emulation.
- Compatible KubeVirt, CDI and CloudNativePG versions as recorded in `infra/provision-sources.json`, ready CRDs/operators, and the required VirtioFS feature support. The operator owns their installation and lifecycle; the local provisioning script must not be run against a remote context.
- A provider CSI StorageClass named `vm-managed`, with filesystem ReadWriteOnce, suitable capacity, node/zone placement and working CDI import/clone. Create it through your provider's documented CSI configuration (e.g. EBS CSI or Azure Disk CSI), not a local path volume. Expansion remains separately gated; no managed expansion claim.
- A CNI which actually enforces the provided NetworkPolicy rules, no public exposure, and registry pull access for the service pods and generated exchange broker. Use authorized node identity or scoped registry pull credentials; do not grant registry or cluster secrets access to application code.
- Actual operator-approved test identity, export token and TLS certificate secrets matching `infra/app.yaml`; no production authentication claim.

## Build and render

On an authorized Linux build host with Buildah, Git and the Node package registry available:

```sh
bash scripts/build-oci.sh archive /tmp/vm-interface.oci.tar
```

Publish the OCI archive with an authorized OCI registry client and obtain its verified immutable manifest digest. Use an image matching the managed worker architecture. Do not publish guest disks or credential files.

```sh
node scripts/render-managed-kubernetes.ts --image 'registry.example.org/team/vm-interface@sha256:REPLACE_WITH_64_HEX_DIGEST' --output ./managed-render
```

The renderer ties the exact broker image and pull policy to the admission policy, sets the service and guest CSI storage class, and refuses an unpinned image. Review all generated manifests and secret references before use. Keep the generated directory outside commits.

With an explicit authorized `CONTEXT`, verify actual node KVM capacity, installed APIs, and the provider class. The following commands are operator actions, not an automated cloud provisioner:

```sh
kubectl --context "$CONTEXT" get nodes -o json | node scripts/kvm_capacity.ts
kubectl --context "$CONTEXT" get storageclass vm-managed
kubectl --context "$CONTEXT" api-resources
kubectl --context "$CONTEXT" apply -f managed-render/namespace.yaml
kubectl --context "$CONTEXT" apply --dry-run=server -f managed-render/exchange.yaml -f managed-render/exportPolicy.yaml
kubectl --context "$CONTEXT" apply -f managed-render/exchange.yaml -f managed-render/exportPolicy.yaml
```

Create the explicitly authorized `vm-api-test`, `vm-api-export` and `vm-console-tls` secrets in namespace `vm-interface` following the device guide, and verify `vm-db` is Ready. Then:

```sh
kubectl --context "$CONTEXT" apply --dry-run=server -f managed-render/app.yaml
kubectl --context "$CONTEXT" apply -f managed-render/app.yaml
kubectl --context "$CONTEXT" -n vm-interface rollout status deployment/vm-api --timeout=300s
node scripts/check-rbac-ci.ts --context "$CONTEXT" --storage-class vm-managed
```

Use private operator-authorized API/TLS access; no public load balancer is configured. Validate actual KVM, CNI isolation, storage and evidence on the target cluster before claiming support. Hosted K3s qualification does not prove EKS or AKS runtime compatibility. Preserve issue #12's independent native-device criteria.
