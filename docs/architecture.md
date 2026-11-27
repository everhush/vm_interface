# Architecture and operating model

VM Interface is a versioned, declarative virtualization control plane, not a hypervisor implementation. The product API is implemented in Vinext/TypeScript. KubeVirt reconciles desired VM/VMI state and delegates guest execution to QEMU/KVM. CDI provisions disks; K3s hosts the operators and application. PostgreSQL (CloudNativePG, Drizzle) retains account-scoped durable operations, quotas, credentials and other service state.

| Layer | Source / responsibility |
| --- | --- |
| REST and schemas | [app/api/v1](../app/api/v1), [src/spec.ts](../src/spec.ts), [src/openapi.ts](../src/openapi.ts) — validation, authorization, plan/submit/observe |
| Persistence and orchestration | [src/db.ts](../src/db.ts), [src/operation.ts](../src/operation.ts), [src/reconcile-operation.ts](../src/reconcile-operation.ts), [src/quota.ts](../src/quota.ts) — durable receipts and convergence |
| KubeVirt and CDI | [src/kube.ts](../src/kube.ts), [src/storage.ts](../src/storage.ts), [src/media.ts](../src/media.ts), [src/data-disks.ts](../src/data-disks.ts) — scoped API operations and storage |
| Display and input | [src/console-gateway.ts](../src/console-gateway.ts), [src/console-tickets.ts](../src/console-tickets.ts), [src/input-lease.ts](../src/input-lease.ts) — authenticated WSS/RFB, exclusive control and revocation |
| Files and recording | [src/exchange-files.ts](../src/exchange-files.ts), [src/recording-worker.ts](../src/recording-worker.ts) — owned byte streams and consented MP4 |
| Network | [src/network.ts](../src/network.ts), [src/network-gateway.ts](../src/network-gateway.ts) — narrowly scoped private guest TCP grants |
| Deployment | [infra/app.yaml](../infra/app.yaml), [infra/provision-sources.json](../infra/provision-sources.json) — namespace roles, operator versions and policies |

## State and trust boundaries

The caller never needs Kubernetes credentials. Strict schemas and allowlisted native fields reject arbitrary manifests and host devices; resource ownership is checked on operations, disks, tickets, recordings and grants. Server-side dry-run precedes operations where supported. Desired reservations count stopped computers and retained disks. Operation reconciliation observes actual state rather than inferring success from an HTTP acknowledgement; uncertain mutations require explicit reconciliation.

Console and tunnel access are independently scoped. A VNC observer cannot inject input. A control ticket still requires an exclusive lease; revocation or instance change fences stale authority. A network grant exposes only the declared private guest TCP port. The system does not expose raw Kubernetes, QMP, libvirt or node shell endpoints to clients.

Guest data, media staging, recordings and metadata have distinct lifetimes. CDI imports create independent writable guest disks; public acquisition is client-side with exact digest and bounded approved HTTPS hosts, not unrestricted server-side URL fetching. Exchange and exports verify byte count and integrity; exports require appropriate halted state. Ordinary local-path PVCs are not expandable. The opt-in CSI profile uses a qualified driver and explicit storage-only admission fencing.

## Deployment profile

The supported evaluation is a fresh disposable Linux device with real KVM. The pinned manifests provision K3s, KubeVirt, CDI and CNPG. The namespace deployment runs API, console, recording and reconciliation processes, with dedicated storage and scoped Kubernetes identities. The exchange broker is used for mounted file access. No public internet ingress or production identity provider is supplied. The application starts from locked npm dependencies; operator release manifests have exact integrity pins, not a blanket signature/SBOM claim.

See [device validation](device-validation.md), [API](api.md), [security policy](../SECURITY.md), and [validation results](validation.md). The [original specification](product-specification.md) is an aspirational scope/acceptance record, not an implemented feature list.

## Deployment profiles

The application is packaged as an OCI image. Local disposable K3s uses an isolated Buildah image store and imports the image archive into K3s containerd; no separate container engine is used for application deployment. Remote managed Kubernetes uses a registry image pinned by digest, operator-installed KubeVirt/CDI/CNPG, and a provider CSI class named `vm-managed`. See [managed Kubernetes](managed-kubernetes.md). Managed-cluster execution is not yet qualified; no production claims.
