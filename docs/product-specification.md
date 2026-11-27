# Historical product specification

> **Archived design and implementation brief.** The original directive below is retained for traceability, not as current operating instructions or an implemented-feature list. The owner replaced the mandatory Windows demonstration with Linux x86_64; native Android ARM64 remains pending. See the [project README](../readme.md), [qualification record](validation.md), [current requirements](requirements.json) and [device acceptance guide](device-validation.md) for the current scope and state. Do not execute historical automation, deployment or acceptance instructions independently of the current guides and operator authorization.

---

# Autonomous Implementation and Continuous End-to-End Validation Directive

## 1. Objective and Authority

Implement the complete API-based virtualization platform described in the technical specification below. Take ownership of the entire implementation, testing, debugging, infrastructure setup, CI/CD configuration, documentation and verification process.

This is an implementation task, not a research, planning or prototype exercise. The objective is to deliver a fully functional, thoroughly validated platform.

**Work autonomously. Make your own engineering decisions. Do not wait for approval, ask implementation-related questions or stop after producing a plan.** Investigate alternatives, resolve problems, make reasonable assumptions and continue implementing and validating the product.

This directive takes precedence wherever it conflicts with the specification below for the current implementation phase.

## 2. Current Implementation Scope

Focus exclusively on the virtualization backend and its unified APIs.

- Implement the complete VM management and operation capabilities described in the specification.
- Do not implement the visual management dashboard or general frontend at this stage.
- Defer production authentication, account registration, OAuth and identity-provider integration. Use a minimal, isolated test identity mechanism where necessary, while preserving account-scoping and authorization boundaries for future integration.
- Do not implement AI models, agents, agent runtimes, task planners or agent-specific integrations.
- Do not work on production cloud deployment, AWS EKS deployment or cloud infrastructure provisioning.
- Use K3s as the Kubernetes environment for implementation and end-to-end validation within CI/CD.

A minimal VNC viewer or inspection page is acceptable where required to observe and validate virtual machines. This does not require implementing the product dashboard.

## 3. Mandatory Technology Stack

Follow the technology stack defined in the specification.

**Vinext and TypeScript must be used for the application API layer.** Do not substitute Express, FastAPI, NestJS or another application API framework.

Use K3s, KubeVirt, CDI, QEMU/KVM, CloudNativePG, PostgreSQL, Drizzle, VirtioFS and the other specified components wherever applicable.

Reuse existing reliable libraries, protocols, Kubernetes operators and established implementations instead of unnecessarily recreating them.

Deviation from the selected technology stack is acceptable only when a component is demonstrably incompatible, impossible to use in the required environment, or an alternative significantly simplifies the implementation without sacrificing required functionality, reliability or maintainability. Document and validate such decisions.

The Vinext API requirement is not optional.

## 4. CI/CD-First Development and Validation

Perform the entire implementation and validation process through CI/CD pipelines.

Establish the pipeline at the beginning of development and continuously improve it throughout implementation. Do not postpone CI/CD setup or integration testing until the application is complete.

The pipelines should handle:

- Dependency installation, builds, type checking, linting and automated tests.
- Provisioning or preparing a KVM-capable test runner.
- Creating a functional K3s test environment.
- Installing and configuring KubeVirt, CDI, CloudNativePG, storage, networking and other required dependencies.
- Deploying the actual application into K3s.
- Checking application and infrastructure readiness.
- Downloading and preparing guest operating system images and installation media.
- Executing real API-driven end-to-end tests.
- Collecting logs, screenshots, recordings, test results and diagnostic artifacts.
- Cleaning up or safely reusing test infrastructure and cached resources.

Use suitable CI runners with actual virtualization support and compatible processor architectures. Where ordinary hosted runners cannot provide KVM, nested virtualization or ARM64 execution, investigate and configure suitable available alternatives.

Do not provision paid cloud resources or deploy a production cloud environment. Report infrastructure limitations accurately.

**The CI/CD pipeline must validate real functionality, not merely successful compilation, mocked APIs or simulated VM operations.**

## 5. Unified API-Only Validation

Every supported product capability must be accessible through documented, unified APIs.

Create and continuously maintain simple, reproducible end-to-end test scripts that interact with the running application through its actual APIs.

The scripts must use documented HTTP requests and authorized console connections to perform VM operations. Do not bypass the application API by directly manipulating KubeVirt resources, Kubernetes manifests, hypervisor commands or guest files from the CI runner.

Direct infrastructure operations are permitted for environment provisioning, diagnostics and infrastructure-level testing, but not as substitutes for product functionality.

Validate every applicable capability in the specification, including:

- Declarative VM configuration, schema discovery, validation and dry runs.
- VM creation, inspection, modification, startup, shutdown, restart and deletion.
- CPU, memory, storage, architecture, firmware, boot media and supported device configuration.
- Guest operating system installation and boot.
- Live virtual display observation and screenshot capture.
- Keyboard, mouse and other supported input injection.
- VNC connectivity, shared sessions, input ownership and control transfer.
- Uploading actual local file bytes into virtual machines and downloading resulting files.
- Video recording through the VM console and retrieval of playable recording artifacts.
- Guest networking and authorized application exposure.
- Persistent storage, supported snapshots and recovery.
- Resource limits, isolation, operation tracking, idempotency, failure handling and reconciliation.
- Restart recovery and interrupted-operation handling.
- All other applicable acceptance criteria from the specification.

Maintain a requirement-to-test coverage matrix. Each requirement must have corresponding implementation and validation evidence.

Features that depend on specific hardware, guest operating systems or infrastructure must be validated on suitable infrastructure before being claimed as supported.

## 6. Linux x86_64 End-to-End Demonstration

Develop a reproducible API-driven script that performs a complete Linux x86_64 VM workflow.

Choose a suitable freely obtainable Linux distribution, version and installation or prepared disk image. Windows is conditional, not a mandatory demonstration. The latest version is not required. Prioritize legally usable, reliably obtainable and reproducible installation media.

The script should:

1. Download or obtain the selected Linux image from a reliable, authorized source.
2. Import the installation or digest-pinned prepared disk media through the platform API and CDI.
3. Submit a declarative VM configuration with compatible resources, firmware, storage and devices.
4. Create and start the VM.
5. Observe the actual virtual display through the supported console interface.
6. Install or configure Linux using supported API-driven input and authorized installation mechanisms.
7. Upload a suitable software installer through the VM file API.
8. Install, launch and operate the software.
9. Verify the actual result using screenshots, guest-visible output or other supported evidence.
10. Demonstrate supported configuration changes, file retrieval and VM lifecycle operations.
11. Capture and retrieve a playable video recording through the platform's recording API.

Perform as many iterations as necessary to make the workflow reliable and reproducible.

Use legally permitted installation media and software. Do not bypass licensing, activation or authentication requirements.

## 7. Android ARM64 End-to-End Demonstration

Develop a corresponding API-driven script for a compatible Android ARM64 virtual machine.

You are responsible for researching and selecting a suitable Android or AOSP image, compatible virtual hardware, boot configuration and installation approach.

The latest Android version is not required. Select an image that can be obtained consistently and reliably booted on supported ARM64 virtual hardware.

The script should:

1. Obtain and import a compatible Android ARM64 image.
2. Submit the declarative VM configuration.
3. Create and boot the virtual machine.
4. Observe the actual virtual display.
5. Perform supported keyboard, pointer, touch-equivalent or other available input operations.
6. Upload an APK through the platform API.
7. Install and launch the application using supported, authorized mechanisms.
8. Perform meaningful functional checks and verify the observed results.
9. Demonstrate supported VM configuration, file exchange and lifecycle operations.
10. Capture and retrieve a playable video recording through the API.

Investigate alternative Android images and configuration approaches when necessary. Continue iterating until a reliable implementation is established.

Do not silently substitute x86 Android emulation for ARM64 validation. Clearly distinguish verified capabilities from conditional or unsupported ones.

## 8. Reproducible Image Acquisition

Select reliable sources for Windows, Android, Linux and other images required for testing.

Maintain reproducible image acquisition scripts that document:

- Source URL or image registry.
- Operating system version and architecture.
- Image format and boot requirements.
- Integrity verification using checksums or signatures where available.
- Licensing and usage constraints.
- Image preparation and import steps.

Use caching where appropriate to reduce repeated downloads and improve CI execution times.

The platform must support real guest image acquisition, import, configuration and booting, whether the selected media is an ISO, disk image, container disk or another supported format.

## 9. Continuous CI Monitoring and Autonomous Iteration

Establish a persistent autonomous monitoring and implementation workflow using the available scheduling, agent and CI/CD capabilities.

**Prefer continuous or event-driven monitoring over fixed-interval polling.**

If supported, create a continuously operating or event-triggered monitoring task that:

- Observes running CI/CD pipelines.
- Detects completed, failed, cancelled and stalled jobs.
- Inspects workflow logs and generated artifacts.
- Observes actual VM screens through API-issued VNC connections, screenshots and recordings where necessary.
- Identifies root causes of failures.
- Modifies the implementation, test scripts, dependencies or pipeline configuration as appropriate.
- Commits the changes and triggers subsequent validation runs.
- Continues working without requiring another user instruction.

If continuous or event-driven autonomous monitoring is unavailable, **create an hourly recurring monitoring and implementation schedule** using the available execution capabilities.

Each scheduled execution should resume from the latest repository and pipeline state, inspect previous results, resolve outstanding problems and continue development.

Ensure only one implementation or monitoring worker performs conflicting changes at a time. Avoid duplicate CI runs, overlapping modifications, uncontrolled retry loops and unnecessary resource consumption.

A CI schedule that merely reruns tests without inspecting failures and taking corrective action is not sufficient for autonomous monitoring. If persistent agent scheduling is unavailable, explicitly document that limitation and continue iterating during the available execution session.

## 10. Continuous Improvement and Verification

Do not stop merely because the first implementation works or the first pipeline passes.

Repeatedly review the entire platform against the specification and investigate:

- Missing or incompletely implemented capabilities.
- Incorrect assumptions about infrastructure or guest support.
- Unnecessary abstractions and duplicated functionality.
- Reliability, security and data-integrity problems.
- Unhandled API errors and edge cases.
- Inadequate test coverage.
- Flaky, non-reproducible or excessively slow tests.
- Differences between requested configuration and actual VM state.
- Opportunities to simplify and improve the implementation.

Continuously improve the implementation and validation scripts together.

Do not weaken, skip or remove meaningful tests merely to obtain a passing pipeline.

Maintain a persistent implementation and verification record in the repository so that subsequent executions can resume work without losing context.

## 11. Completion and Stopping Criteria

Continue working until the entire applicable specification has been implemented and validated through CI/CD.

A single successful pipeline is not sufficient.

Before considering the work complete, perform **at least three consecutive comprehensive validation and review iterations** in which:

- All applicable end-to-end tests pass.
- Both Linux x86_64 and Android ARM64 demonstration workflows succeed on appropriate infrastructure.
- The generated recordings and artifacts are valid and retrievable.
- No unresolved defects, regressions or missing in-scope requirements are identified.
- The requirement-to-test coverage matrix is complete.
- Reproducible setup and execution instructions are available.
- No further actionable improvements are identified within the defined implementation scope.

If an iteration identifies a problem, fix it, rerun validation and restart the consecutive-success count.

Only conclude the implementation after these conditions are satisfied. Disable the autonomous implementation schedule once completion is verified, while retaining the ordinary regression-testing pipelines.

If an essential capability is genuinely blocked by unavailable hardware, licensing, external access or execution limitations, document the exact blocker, attempted alternatives and remaining validation requirements. Do not falsely declare that capability complete.

## 12. Final Deliverables

The completed repository must contain:

- The working Vinext-based virtualization API application.
- Kubernetes/K3s deployment configurations and required infrastructure definitions.
- Complete CI/CD workflows.
- Documented REST/OpenAPI contracts and configuration schemas.
- Reproducible guest image acquisition and preparation scripts.
- Linux x86_64 and Android ARM64 API-driven demonstration scripts.
- Comprehensive unit, integration and real end-to-end tests.
- Requirement-to-test coverage and validation records.
- Downloadable screenshots, recordings and other CI-generated evidence.
- Setup, operation, testing and troubleshooting documentation.
- An accurate list of supported, conditional and unsupported capabilities.

**Begin implementation immediately. Own the entire process from initial infrastructure setup to final validated functionality. Use the specification below as the complete technical requirements baseline, make independent decisions, continuously monitor and improve the implementation, and do not substitute planning or simulated demonstrations for working software.**

# API-Operated Virtual Machine Platform

## Scope and authority

VM Interface is a standalone, account-based service for people and external API clients to create, configure, install, observe and operate virtual computers. It supplies computers and their management APIs, **not an AI agent, model, planner, task orchestrator or chatbot**. A human uses its web console; scripts and external agents use the same documented APIs with an authorized account API key. The service does not depend on any external agent or chatbot runtime.

## 1. Product and account experience

- A user signs in, creates an account/workspace, sees its VMs and quotas, and launches a VM using a supported image or uploaded installer with an initial CPU, RAM, GPU and storage profile. Accounts may contain multiple independent VMs and authorized human members.
- Each account owns its VM definitions, disks, images/artifact references, access sessions, operation history, network exposures and API keys. All application reads, writes, background operations and console connections enforce account ownership.
- Offer a simple create flow with safe defaults and an advanced configuration editor. Users can inspect capabilities and costs/resource estimates before committing and change supported options later.
- Account API keys allow clients to access **any VM owned by that account**, not just one specific VM, subject to the key's operation permissions. Keys can be created, labeled, rotated, revoked and expired; show the value only at creation and keep only a verifier/hash server-side. An API client does not obtain cluster credentials.
- Every VM has a stable ID and its own fresh, revocable, VM-scoped browser/console link. Such a link is a short-lived access ticket, not an account API key or authority to manage other VMs.
- Humans and API clients can simultaneously observe the *same running VM*. Mutating console input requires explicit control ownership and a human-priority takeover/release mechanism.

## 2. Deployment and technology

| Layer | Selected direction |
|---|---|
| Production | **AWS EKS**, one operator-configured Kubernetes cluster with eligible VM-capable node pools; cluster provisioning, node-pool sizing, autoscaling bounds, networking, quotas and cost ceilings are operator responsibilities |
| Local and CI | **K3s** with the same Kubernetes/KubeVirt application contracts; virtualization features are enabled only when the local host actually supports them |
| Full VM lifecycle | **KubeVirt** VirtualMachine / VirtualMachineInstance resources and controllers, with QEMU/KVM underneath; KubeVirt is the sole lifecycle owner |
| Storage and imports | Kubernetes PVC/CSI StorageClasses, **KubeVirt CDI**, optional supported VM snapshots and per-VM exchange volumes |
| Application/API | **TypeScript and Vinext** (Vite-based Next-compatible application/route handlers) for login, dashboard and versioned HTTP endpoints; durable controllers/jobs and an authenticated WebSocket console gateway remain server-side workloads |
| Frontend/toolchain | **Vinext (Vite-powered Next.js-compatible UI), Vite+ and daisyUI** (Tailwind CSS component library); responsive VM management dashboard with **noVNC** in a separate VM viewer page |
| Durable product data | **PostgreSQL via CloudNativePG inside Kubernetes**, with Drizzle for application persistence; persistent VM disks and large artifacts reside in authorized storage, not in database rows |
| Guest file exchange | **VirtioFS** with a validated shared PVC/access path where supported; authenticated guest transfer as fallback |
| Dynamic memory | Supported KubeVirt memory hotplug with verified host/guest/migration topology; **virtio-mem** is a separate experimental/evaluation path, not assumed equivalent |
| Security boundary | Application authentication and account authorization; server-side scoped Kubernetes ServiceAccount/RBAC, never raw Kubernetes or hypervisor credentials in browsers or external API clients |

The EKS target is **not** a guarantee that every EC2 worker supports KubeVirt, nested virtualization, GPU passthrough or live migration. Validate the actual worker instance, KVM/device access, node placement, StorageClass/CSI, network, KubeVirt version and operator support before advertising each capability. Keep application workloads inside the configured cluster; do not silently buy instances, modify node pools or exceed cloud quotas. K3s proves local operation only, not automatic EKS feature parity. Vinext/Vite+/daisyUI compatibility and standalone Kubernetes deployment must be validated with the selected releases.

## 3. Computer model and lifecycle

A versioned declarative **ComputerSpec** is the source of requested configuration; return the validated and **resolved** KubeVirt state and current VM/VMI status separately. It includes identity/labels, OS/image, CPU architecture and topology, initial/minimum/maximum resources, boot order/media, firmware, virtual devices, disks, networks, display/console and retention/idle policy.

- Support validate/plan (including dry-run and capability errors), create, list/search, inspect, modify, start, stop, restart, reset, and delete; pause/resume, clone, snapshot/restore, image export and migration are available only where the installed KubeVirt/storage path passes conformance.
- Users may supply a simplified profile or advanced schema-validated KubeVirt VM specification. Expose native supported KubeVirt CRD fields, resource options and applicable feature constraints through versioned machine-readable schemas/capability discovery rather than manually hard-coding every hardware flag.
- Advanced configuration may include validated, explicitly namespaced KubeVirt-supported extensions and declarative patch/diff operations. Enforce namespace, account ownership, admission, quotas and safe resource kinds; **do not** expose arbitrary host shell commands, raw QEMU flags/QMP/libvirt sockets, unmanaged Kubernetes objects or unbounded privileged manifests.
- Return desired versus effective CPU, RAM, devices, volumes and status; distinguish pending changes, applied changes, live changes and those requiring shutdown/restart. Reject unsupported combinations explicitly instead of silently substituting hardware.
- All mutating requests use idempotency keys and durable operation IDs with progress, timestamps, retry/reconciliation results, cancellation where safe and structured failure reasons. A network timeout cannot create duplicate VMs or repeat a destructive action.
- Use KubeVirt-managed start/stop and launcher reconciliation. Never delete virt-launcher Pods or start independently managed QEMU processes for a KubeVirt VM.

## 4. Resources and dynamically configurable hardware

Users can select small **initial** allocations and later request changes through the same UI and API, within account quota, eligible-node capacity and configured physical reserves. Per-VM and aggregate capacity accounting includes actual/reserved CPU, memory, disk, networking, accelerator/GPU/VRAM and hypervisor overhead; one VM must fit one eligible node.

| Resource | Required behavior and constraints |
|---|---|
| **CPU** | Configure vCPU count, cores/sockets/threads and eligible CPU model/features. Expose verified KubeVirt vCPU hotplug only where migration/LiveUpdate and guest/host support permit; otherwise apply through a controlled stop/restart and verify the effective allocation. |
| **RAM** | Configure initial/current/maximum RAM and inspect actual pressure. Use documented KubeVirt memory hotplug only when the exact architecture, guest and migration/storage path is validated; otherwise controlled restart. Do not assume hot-unplug, ballooning or live shrink is safe. |
| **virtio-mem** | Separately evaluate device support, requested/max/preallocated memory, guest online/offline behavior and reclamation. Advertise it only after end-to-end proof, never as an assumed KubeVirt hotplug implementation. |
| **GPU / vGPU** | Offer GPU passthrough or mediated/vGPU profiles only with verified node hardware, IOMMU/VFIO, device plugin/DRA support where applicable, driver/licensing and guest compatibility. On EKS prefer validating suitable GPU-equipped bare-metal worker profiles; GPU-capable Pods do not prove GPU-enabled VMs. Account for exclusive allocation, VRAM and migration restrictions; do not promise live GPU resize. |
| **Persistent disks** | Create, attach/detach, inspect, import, export and increase disk/PVC size within quota; distinguish PVC expansion from guest partition/filesystem growth. Never imply safe in-place shrink or concurrent offline writes. |
| **Exchange drive** | Each VM has a distinct persistent file-exchange volume, with quota and optional growth where CSI/filesystem support it. Keep its lifecycle distinct from the boot disk. |
| **Network/devices** | Configure supported NICs, virtual controllers, TPM, graphics/audio/serial, USB/PCI/host devices and eligible hotplug only when the exact KubeVirt version, node, guest and policy support it. |

When a live change is unavailable, show whether a restart is necessary and preserve disks and VM identity. A failed change retains or restores the last confirmed configuration. If capacity is insufficient, return a useful refusal or queue eligible work; do not overcommit node memory or silently trigger unconfigured infrastructure scaling.

## 5. Guest OS, boot media and virtual devices

- Support x86_64 and ARM64 **on matching eligible hosts** as the normal accelerated profiles. Cross-architecture QEMU emulation is conditional, slower and not a guaranteed production path. A particular ARM board or phone image is not interchangeable with a generic virtual machine.
- Allow Linux, Windows, compatible Android/AOSP and other guest operating systems where a bootable image, firmware, drivers, license and actual backend tests exist. No promise of universal Windows ARM64, Android, Raspberry Pi OS, macOS or iOS support; Apple's hardware/licensing restrictions and physical-device fidelity still apply.
- Configure supported BIOS/UEFI, Secure Boot, boot menu/order, removable/installer ISO, machine type, CPU features, graphics, TPM 2.0/persistent TPM state, network/disk bus and other KubeVirt-exposed devices. Physical PCI NVMe passthrough is not a generic emulated NVMe controller; verify each advertised bus and device.
- Let clients upload/register media, select a catalog image, use a verified upstream source or import a prepared disk. Verify metadata/checksums or signatures where available, detect architecture/format, attach/eject media and boot into firmware, installer or desktop. The installation sequence and guest software are controlled by the **human or external client**, not by a built-in VM Interface agent.
- Allow OS-native unattended installer/config media and guest drivers when the client supplies them; never inject logins, bypass activation/MFA, or assume an arbitrary mobile vendor image boots.
- The guest-agentless baseline includes boot, firmware/installer visibility, keyboard/pointer console input, host-side resource/media operations and VM lifecycle. Guest-aware file operations, exec, detailed telemetry and graceful OS actions are conditional on a validated guest-native path.

### 5.1 Image discovery registry (full VMs)

These are source references, not guaranteed ready-to-boot templates. Prefer maintained catalogs and official publishers to arbitrary discovered URLs.

| Rank | Source | Role | Usage |
|---|---|---|---|
| 1 | [KubeVirt Containerdisks](https://github.com/kubevirt/containerdisks) | Curated Linux images, including supported x86_64/ARM64 variants | Prefer compatible KubeVirt OCI disks |
| 2 | [Quickget / Quickemu](https://github.com/quickemu-project/quickemu) | Broad Linux/Windows/BSD/version and installer URL discovery | Obtain authorized media for preparation/import |
| 3 | [Incus images](https://images.linuxcontainers.org/) | Multi-architecture Linux VM images | Adapt/import compatible disks |
| 4 | [KubeVirt Machine Images](https://github.com/ContainerCraft/kmi) | Community KubeVirt OCI images | Verify maturity and source |
| 5 | [libguestfs virt-builder](https://libguestfs.org/virt-builder.1.html) | Linux disk templates | Prepare/convert VM disks |
| 6 | [netboot.xyz](https://netboot.xyz/) | Network installers and recovery media | Require compatible boot/network path |
| 7 | [osinfo-db](https://gitlab.com/libosinfo/osinfo-db) | OS/version metadata; not an image registry | Resolve guest metadata/configuration |

### 5.2 MicroVM image and runtime references

MicroVM execution is **optional and separately capability-gated**; KubeVirt remains the only full-VM lifecycle owner. A conventional Firecracker guest needs a compatible kernel/root filesystem, not an arbitrary installation ISO. Kata primarily runs OCI workloads, not general-purpose desktop OS installations.

| Rank | Source | Role | Limitation |
|---|---|---|---|
| 1 | [FireCrab](https://github.com/SteelCrab/firecrab) | Selected Firecracker-oriented Linux images | Validate maturity; not Kubernetes-native VM management |
| 2 | [Kata Containers](https://github.com/kata-containers/kata-containers) | OCI workloads isolated in lightweight VMs | Not a broad guest OS catalog |
| 3 | [firecracker-containerd](https://github.com/firecracker-microvm/firecracker-containerd) | Firecracker OCI runtime integration | Requires prepared guest environment |
| 4 | [Unikraft](https://unikraft.com/docs/cli/registries) | Unikernel/application images | Not normal Windows/Android/Linux desktop installs |
| 5 | [Firecracker reference images](https://github.com/firecracker-microvm/firecracker) | Example/test kernel and rootfs | Reference artifacts only |
| 6 | [Weave Ignite](https://github.com/weaveworks/ignite) | Historical OCI-to-Firecracker workflow | Archived; reference only |

Image acquisition supports account upload, previously registered artifact, catalog resolution and authorized URL import. Record source, digest, size, format, build/OS hints, verification and license status. Use safe streaming/resumable transfer for large files and guard URL fetching against SSRF, redirects, DNS rebinding, private metadata endpoints and excessive downloads. Reuse verified cached images without sharing writable disks or confidential data across accounts.

## 6. Real display, VNC access and input

- Supply an authenticated VM-scoped **VNC WebSocket** gateway to KubeVirt's private VNC subresource. A browser uses **noVNC**; an API client or agent may connect using its existing compatible RFB/VNC library. Do not write a new RFB implementation or expose direct KubeVirt, QMP, libvirt or raw node sockets.
- Support live framebuffer observation and on-demand screenshots through an authenticated API (capture dimensions, display/VM identity, timestamp and failure state). These must work at firmware, bootloader, installer, login and desktop stages without a guest-side VNC server.
- Offer explicit start/stop/status operations for **opt-in display video recording** from the authorized VM console stream, without installing a guest recorder. On completion, return a durable recording artifact with format, duration, size and a retrievable video file through the account API. Record only video unless a separate supported audio-capture path is verified; report capture failure or incomplete output explicitly.
- Support keyboard press/release, modifiers, supported text entry, pointer absolute/relative motion, clicks/buttons and wheel/scroll through VNC. Allow validated input-event batches and fresh screenshot capture for an observe → act → observe loop. Accepted input is not evidence that a guest application completed an action.
- Detect/report display resolution, orientation/cursor information where exposed, resize and supported input limits. Genuine multitouch/contact lifecycle, stylus, gamepad and virtual HID are **conditional** on a working KubeVirt-exposed device, guest driver and end-to-end tests; do not equate pointer emulation with touch.
- Viewer and API clients can observe the same screen concurrently. Apply a single mutating-input lease/authority per VM, visible to human clients, with handoff, expiry, revocation and immediate human takeover. The gateway must enforce this for **all** viewer/RFB input paths; neither noVNC nor raw API VNC clients may bypass it. Do not add a second VM manager or independent QMP input control plane.
- Console sessions use short-lived VM-specific tickets and WSS; disconnect/reconnect cannot destroy the persistent VM. Track actual input/active sessions, protect credential entry from recording/observation where supported, and never log password keystrokes or screen pixels by default.

## 7. Disks, files, artifacts and backups

- Each VM has a persistent system disk and a separate per-VM exchange volume. A stopped VM retains its definition and PVC-backed data until authorized deletion/retention action. No fixed seven-day deletion rule.
- Prefer **VirtioFS** for a VM-visible exchange volume only if the KubeVirt release, CSI access modes, guest driver, UID/GID semantics and concurrent file consistency have been validated. Otherwise expose a verified, authenticated guest-transfer path if available; report unsupported file exchange rather than claiming access to arbitrary guest filesystem paths.
- **Client → VM:** The authenticated user or API client uploads the actual local file bytes via HTTP multipart or streamed/resumable request to a selected VM; the backend validates/stages the file and makes it available inside that VM's exchange directory. A URL or pre-existing artifact ID is optional, not required. Return transfer status and the resulting VM path/reference.
- **VM → client:** List eligible files in that VM's exchange directory and download their actual bytes through the authorized API (streaming/range/resumable where appropriate), or obtain an expiring download URL. Support browser and external API clients equally; guest-initiated uploads and VM-to-VM transfers are not required. Use atomic publication/completion checks, file size/checksum/provenance, safe paths and account/VM isolation; never expose unrelated guest files or partially written output as completed.
- Offline disk inspection, format conversion, partition preparation, import/export, cloning and supported snapshot/restore may use restricted jobs with safe arguments, limits and audit. Do not mount a live writable guest filesystem through an unsafe second writer. Snapshot consistency, guest quiescing and full-running-state snapshots are separate validated capabilities.
- Allow declared snapshot/backup retention and recovery for persistent VM volumes and product records where the deployed storage backend supports them. Backup/restore must be verified, account-scoped and explicit about downtime and guest consistency; do not promise unsupported live snapshots.
- Capacity growth respects PVC, block-storage and guest-filesystem boundaries. Deletion must warn about affected volumes/artifacts and support separate retention policy where appropriate.

## 8. Guest networking and application exposure

- Private guest networking and restricted egress by default; expose account-configurable NIC/network attachments, DNS, allowed egress and internal VM communication where the CNI/backend support them.
- Support authorized port-forward or service exposure for guest applications, with chosen destination, access policy, time limit, revocation and clear active mapping/status. A publicly reachable port/hostname requires explicit approval and cannot reveal Kubernetes management, VNC or node APIs.
- Provide a controlled network endpoint that external clients can use without receiving cluster/network-admin privileges. Stop/revoke forwarding when the underlying VM is no longer eligible, the grant expires or the account owner revokes access.
- Expose network throughput/connection constraints and optional advanced interfaces only after guest/device compatibility checks.

## 9. Versioned APIs for humans and external agents

Publish **REST/OpenAPI**, machine-readable ComputerSpec and capability schemas, and clear error/operation contracts. The UI and external automation consume the same authoritative account-scoped operations; no agent-specific tool registry, built-in MCP server or orchestration framework is required.

| API group | Required operations |
|---|---|
| **Account and keys** | Current account, quotas, key create/list/revoke/rotate, sessions and authorized human access |
| **Computers** | Plan/validate, create/list/get, update declarative spec, start/stop/restart/reset/delete; conditional pause/resume, clone, snapshot/restore/migration |
| **Capacity and capabilities** | Supported architecture, node/VM profile, firmware/device options, resource limits, live-versus-restart changes and availability |
| **Advanced configuration** | Read schema, submit validated KubeVirt-supported fields/patches, preview effective diff, reconcile and inspect unsupported fields |
| **Media and storage** | Catalog discovery, upload/register/import/verify media, attach/eject, disk and exchange-volume management; VM-targeted file-byte upload, list/status and file-byte download, with optional signed URLs |
| **Console and input** | Fresh VM-specific VNC ticket, WSS gateway, screenshot/frame, input/lease status, request/release/takeover and revoke; opt-in recording start/stop/status and recorded-video file retrieval |
| **Network** | Private networks, NICs, allowed port exposures, status, expiry and revocation |
| **Operations and audit** | Job status/progress/failure, retry/cancel where safe, history, usage, events, warnings and reconciliation |

Do not bind the API to a particular agent framework or force clients to use a generated SDK. Optional SDK/CLI tools may be thin clients of these same endpoints. Use account-level keys for all account-owned machines; **VM-scoped viewer tickets are separate short-lived transport grants**. Do not issue durable per-VM API keys as the primary model.

## 10. Web interface

The Vinext dashboard offers sign-in/account selection, quota and capacity summaries, VM list/search, creation wizard, advanced configuration editor with schema validation and dry-run, operation progress/errors, media/image browser, resource sizing, disks and file upload/download, networking/port exposure, snapshots/backups where supported, API-key management, audit and usage.

A separate authenticated VM URL opens the noVNC viewer with live display, input/lease state, takeover/release, screenshot, opt-in screen-recording and local-file upload/download actions. Keep the viewer usable on desktop and mobile where the chosen input modes work; do not claim browser touch equals true guest multitouch. Provide clear loading, unsupported capability, reconnect, failed action and stopped-VM states. The human can perform OS installation and third-party sign-in inside the VM; the service does not automate or impersonate that user.

## 11. Security, persistence and operations

- Enforce **account isolation** server-side for every API call, asynchronous job, VM/PVC object, network route, console session, uploaded file, artifact and key. Derive account identity from authenticated context; never accept an unverified account/namespace from the request body.
- Use OIDC/OAuth sign-in for web users with secure sessions, and hashed/rotatable account API keys for automated access. Apply account-level permissions and action-specific checks for destructive operations, public exposure, image import and privileged devices. Log key usage metadata without recording credentials.
- Use dedicated Kubernetes identities with only approved VM, VMI, CDI, PVC, console and network operations in managed namespaces. Do not grant cluster-admin, list arbitrary Kubernetes Secrets, access worker hosts, or expose cloud IAM/host credentials to guests or clients.
- Treat guest images, files, guest networks, configuration extensions and console input as untrusted. Restrict device passthrough, host mounts, privileged extensions, uploads/downloads and API input; validate size, types, destinations and rate limits.
- Persist account/computer/spec/version, desired/resolved state, KubeVirt references, operations, file/artifact metadata, resource reservations, sessions/leases, port grants, keys and audit in CloudNativePG. Store persistent VM volumes on CSI storage; reconcile database intent against KubeVirt actual state after failures.
- Implement durable operation recovery, leases/fencing and idempotent retries. Survive API/worker/controller restarts, console disconnect, interrupted imports, VM crash, lost node, storage pressure and cluster reconciliation without duplicate VMs or silent data loss.
- Configurable idle **stop** policy uses real console input, API activity and active sessions/operations; never equate mere guest network traffic with user activity. Do not stop a VM with an active controller/session or eligible ongoing operation. Stopping preserves disks; permanent deletion requires a separate authorized action.
- Provide tenant-appropriate service/VM/volume status, allocation and pressure, capacity and GPU availability, operation history, VNC/lease health, storage and network diagnostics, image import state, billing/cost-budget visibility or estimates, and audit. Redact sensitive contents and do not collect screenshots, keystrokes or recordings by default. Recordings require explicit authorization/consent, visible capture state, retention/deletion controls and protection of sensitive login/MFA screens.
- Apply reasonable limits for accounts, VM count, active sessions, requests, CPU/RAM/GPU/VRAM, disk, image downloads, file transfer, network traffic and cost exposure. Return actionable quota/capability errors and protect healthy accounts from noisy workloads.

## 12. Use cases and conformance

These illustrate platform capabilities, **not built-in automation workflows**:

1. **Human Linux desktop:** Sign in, select a compatible Linux image and small initial profile, boot via KubeVirt, open a VM-specific noVNC link, install applications, transfer files and stop/restart without losing disks.
2. **API-driven computer use (script or external agent):** Create or reuse a VM with an account API key, observe through screenshot/VNC, inject supported keyboard/pointer actions, verify a fresh frame, upload a client-supplied file into the VM-visible exchange directory, download a resulting VM file through the API and return an opt-in video recording as a downloadable artifact. A human can take over the same display to complete an MFA/login step and later release input control.
3. **Windows installation:** Register licensed Windows installer media, configure UEFI/Secure Boot/vTPM and tested drivers, install through firmware/installer console, then preserve the installed desktop for normal use; validate license/activation and device compatibility.
4. **ARM64 Android testing:** On eligible ARM64 nodes and a compatible virtual-device image, boot Android/AOSP, use supported display/input and optional ADB/guest tools to install/test an APK; report API level, ABI, image, input/sensor limitations and actual results.
5. **GPU workstation or training:** On an eligible EKS node with verified passthrough/vGPU, create a GPU-backed VM and inspect assigned device/driver; deny or explain unavailable profiles rather than falsely claiming acceleration.
6. **Resource reconfiguration:** Increase vCPU/RAM/disk within quota; show whether change is live, requires KubeVirt migration or needs safe reboot; separately test virtio-mem evaluation and guest filesystem enlargement.
7. **Hosted guest application:** Expose an approved guest port through a scoped, expiring gateway, then revoke it; public port access never grants a console or Kubernetes permission.
8. **Parallel isolated computers:** Two accounts create VMs and transfer files concurrently; neither can enumerate or affect the other's machines, keys, disks or console sessions.

**API-driven showcase demonstrations (script or external agent):** Run both against an already deployed VM Interface using only its documented account APIs and authorized VM console/guest-access paths; no platform-deployment step, built-in agent, special SDK or mandatory prompt. A deterministic script and an external agent are equally valid clients.

1. **Android ARM64 APK test:** On verified compatible ARM64 VM hardware and a supported Android/AOSP image, create and boot the VM, start opt-in console video recording, upload an APK's actual bytes through the VM file API, install and launch it via available VM console controls or authorized guest-native access (for example ADB where supported), run defined UI/functional checks and verify actual results. Stop recording and return the playable video file, VM reference and test evidence through the API; report any unsupported Android, installation or capture capability.
2. **Linux software test:** On a verified compatible x86-64 Linux VM using authorized pinned media, create and boot/install the guest as needed, start opt-in console video recording, upload a permitted software installer through the VM file API, install and open the application using supported VNC input or authorized guest-native mechanisms, and verify it visibly runs. Stop recording and return the playable video file, VM reference and observed results through the API; handle any interactive login as a human-controlled step.

Show real API calls, VM state, file transfer, inputs, verification and recordings in the demonstrations; do not substitute simulated actions or fabricated success. The interface exposes capabilities, while the script or external agent determines the automation steps.

**Acceptance gates:** The deployment is usable only when account login/API keys, quotas, schema-driven VM creation, KubeVirt lifecycle/reconciliation, image import/boot, firmware-to-desktop console, screenshot and real guest-visible input, shared-session leases, local client file-byte upload into the VM and VM file-byte download, consented screen-recording capture/export, safe networking, errors/retries, idle stop and account isolation pass end-to-end tests. Separately certify each live CPU/RAM change, virtio-mem, VirtioFS profile, GPU passthrough/vGPU, hotplugged device, snapshots/migration and guest/architecture combination **before** advertising it. K3s test success does not establish EKS production compatibility.

## 13. Explicit exclusions and references

No built-in LLM, agent/subagent runtime, chat system, prompt-based OS installer, fixed workflow catalog, mandatory MCP/SDK, public raw VNC/QMP/libvirt endpoint, node-level shell, second full-VM manager, unrestricted Kubernetes manifest execution, automatic cloud-capacity purchase or blanket OS/device compatibility claim. MicroVMs, non-KubeVirt managers and browser/WASM execution are not implicit production requirements merely because their image catalogs are listed.

Technical references: [KubeVirt user guide](https://kubevirt.io/user-guide/), [KubeVirt API](https://kubevirt.io/api-reference/main/operations.html), [CDI](https://kubevirt.io/user-guide/storage/containerized_data_importer/), [CPU hotplug](https://kubevirt.io/user-guide/compute/cpu_hotplug/), [memory hotplug](https://kubevirt.io/user-guide/compute/memory_hotplug/), [host devices](https://kubevirt.io/user-guide/compute/host-devices/), [CloudNativePG](https://cloudnative-pg.io/docs/current/), [Vinext](https://vinext.dev/), [Vite+](https://www.viteplus.dev/), [daisyUI](https://daisyui.com/).
