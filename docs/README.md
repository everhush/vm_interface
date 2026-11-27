# Documentation

Start with the [project README](../readme.md). VM Interface is an Apache-2.0 evaluation source preview: the previous hosted x86_64 KVM qualification is historical; migrated-candidate qualification and native-device acceptance remain pending. It is not a hosted service or a production-ready platform.

| I want to… | Read |
| --- | --- |
| Understand the design and trust boundaries | [Architecture](architecture.md) |
| Try the API and build a client | [API guide and lifecycle walkthrough](api.md) |
| Export a stopped VM's disk or exchange bundle | [Disk export](disk-export.md) |
| Reproduce the evaluation safely on real hardware | [Device validation](device-validation.md) |
| Check exactly what has passed, on which source | [Qualification record](validation.md), [Kubernetes/Vite+ migration](toolchain-migration.md) |
| Review a complete native-device iteration | [Acceptance record template](acceptance-record.md) |
| Contribute or report a defect | [Contributing](../CONTRIBUTING.md), [security policy](../SECURITY.md) |
| Understand what must happen before publication | [Release checklist](release-checklist.md), [third-party terms](../THIRD_PARTY.md) |
| Read the original requirements and engineering history | [Product specification](product-specification.md), [requirements ledger](requirements.json), [implementation record](implementation.md) |

## Which source should I use?

- Browse or build the current `main` source for the evaluation preview. The legacy default branch is kept aligned.
- The migrated candidate is `34652dc2fffd585e8e95aac1a2df63b3552da8f8`. Follow the [migration record](toolchain-migration.md); for #12 acceptance use it only after the issue explicitly approves the exact candidate. Historical evidence is not new same-SHA qualification.
- The original specification and engineering log preserve prior decisions and failures, including superseded Windows requirements. They are historical, not the current feature list or a request to restart development.

## Common questions

**Do I need Kubernetes or KVM to read or test the code?** No. The locked static checks do not install a cluster. Real VM tests require disposable Linux hardware with actual KVM and matching architecture.

**Can I use an existing cluster or expose the API publicly?** Not with the provided evaluation configuration. It uses test identities, local access and disposable provisioning, not production identity, ingress or operational hardening.

**Does Android already work on ARM64?** The pinned inputs and signed APK are prepared. Native guest boot, display, transfer and execution still need issue #12 evidence. Windows is optional and not qualified as a guest.

**Are all hypervisor features supported?** No. The live schema/capability API describes allowed configurations, and the qualification record distinguishes verified and conditional behavior. No arbitrary host shell, unrestricted Kubernetes execution, GPU passthrough, migration or live resize guarantee is made.

**Where are the original recordings?** They remain in retained CI artifacts linked from the qualification record. Access and retention are subject to GitHub and the CI repository. The source tree does not redistribute recordings, VM images, private guest data or generated APKs.

**What is the next milestone?** Independent native-device acceptance in [issue #12](https://github.com/everhush/vm_interface/issues/12); three consecutive comprehensive reviews, currently 0/3.
