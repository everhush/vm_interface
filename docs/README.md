# Documentation

Start with the [project README](../readme.md). VM Interface is an Apache-2.0 evaluation source preview: the migrated hosted x86_64 KVM qualification is complete; independent native-device acceptance remains pending. It is not a hosted service or a production-ready platform.

| I want to… | Read |
| --- | --- |
| Understand the design and trust boundaries | [Architecture](architecture.md) |
| Evaluate a dedicated managed Kubernetes cluster | [Managed Kubernetes deployment](managed-kubernetes.md) |
| Understand schema initialization and upgrade limitations | [Database schema and upgrades](database-schema.md) |
| Maintain branches and public source | [Repository maintenance](repository-maintenance.md), [branch inventory](branch-cleanup.tsv) |
| Try the API and build a client | [API guide and lifecycle walkthrough](api.md) |
| Export a stopped VM's disk or exchange bundle | [Disk export](disk-export.md) |
| Reproduce the evaluation safely on real hardware | [Device validation](device-validation.md) |
| Check exactly what has passed, on which source | [Qualification record](validation.md), [Kubernetes/Vite+ migration](toolchain-migration.md) |
| Review a complete native-device iteration | [Acceptance record template](acceptance-record.md) |
| Contribute or report a defect | [Contributing](../CONTRIBUTING.md), [security policy](../SECURITY.md) |
| Understand what must happen before publication | [Release checklist](release-checklist.md), [third-party terms](../THIRD_PARTY.md) |
| Review requirements and evidence | [Requirements ledger](requirements.json), [implementation record](implementation.md) |

## Which source should I use?

- Browse or build the current `main` source for the evaluation preview. `main` is the sole primary source. The legacy default branch is slated for retirement after the administrator selects `main`.
- For reproducibility and issue #12 use exact hosted-qualified `34652dc2fffd585e8e95aac1a2df63b3552da8f8` and follow the [migration record](toolchain-migration.md) and device guide. Documentation-only successors do not constitute new same-SHA CI.
- The engineering log records past test results; the current issue tracker defines active work.

## Common questions

**Do I need Kubernetes or KVM to read or test the code?** No. The locked static checks do not install a cluster. Real VM tests require disposable Linux hardware with actual KVM and matching architecture.

**Can I use an existing cluster or expose the API publicly?** Not with the provided evaluation configuration. It uses test identities, local access and disposable provisioning, not production identity, ingress or operational hardening.

**Does Android already work on ARM64?** The pinned inputs and signed APK are prepared. Native guest boot, display, transfer and execution still need issue #12 evidence. Windows is a mandatory showcase; native installation and application execution are not yet qualified.

**Are all hypervisor features supported?** No. The live schema/capability API describes allowed configurations, and the qualification record distinguishes verified and conditional behavior. No arbitrary host shell, unrestricted Kubernetes execution, GPU passthrough, migration or live resize guarantee is made.

**Where are the original recordings?** They remain in retained CI artifacts linked from the qualification record. Access and retention are subject to GitHub and the CI repository. The source tree does not redistribute recordings, VM images, private guest data or generated APKs.

**What is the next milestone?** Windows qualification in [#33](https://github.com/everhush/vm_interface/issues/33) and independent native-device acceptance in [issue #12](https://github.com/everhush/vm_interface/issues/12); three consecutive comprehensive reviews, currently 0/3.
