# Changelog

## Unreleased — public, hosted-qualified evaluation source preview

### Current implementation

- Declarative API-first VM lifecycle, strict configuration, account/key scoping, quota reservations and durable operation receipts.
- Kubernetes/KubeVirt/CDI/CNPG deployment with daemonless OCI builds and pinned provisioning sources; persistent disks, verified media imports, independent registered images, clone/export and CSI evaluation.
- Authenticated RFB/WSS display, screenshots, input leases, actual guest keyboard and tablet proof, consented original MP4 recording and private guest TCP tunneling.
- Native Fedora x86_64 application installation, guest file/archive integrity, original recordings, cold CPU/RAM resize and persistence.
- Android ARM64 pinned media, signed APK and both transfer scenarios prepared; actual native guest compatibility not yet qualified. Windows remains optional and historical.
- Consolidated Python-to-TypeScript migration (65 files), locked Vite+ 1.8.0, Vinext runtime, source migration guard and complete static test-report validation. No standalone ESLint/tsx or Dockerfile workflow remains in current source.
- Apache-2.0 licensing, README and public documentation, API walkthrough, security and contribution guidance, database schema/upgrade guide, qualification ledger and branch cleanup inventory.

### Verified qualification — 2026-11-27 UTC

Exact executable commit: [`34652dc2fffd585e8e95aac1a2df63b3552da8f8`](https://github.com/everhush/vm_interface/commit/34652dc2fffd585e8e95aac1a2df63b3552da8f8). [Issue #13](https://github.com/everhush/vm_interface/issues/13) closed as completed. All four hosted lanes passed; retained artifacts independently reviewed.

| Lane | Verified outcome |
| --- | --- |
| [Static](https://github.com/everhush/vm_interface/actions/runs/46077697248) | 158/158 tests in 59 files, no failed/skipped/todo tests; Vite+ check/build/loader/source guard |
| [Core](https://github.com/everhush/vm_interface/actions/runs/46077980605) | 13/13 native stages plus actual restart recovery, compatibility and evidence verifiers |
| [CSI](https://github.com/everhush/vm_interface/actions/runs/46078053324) | Actual guest exchange capacity growth; unchanged volume identities; no boot filesystem certification |
| [Android preparation](https://github.com/everhush/vm_interface/actions/runs/46077983994) | Signed APK and pinned scenarios; offline only |

See [qualification and migration record](docs/toolchain-migration.md) and [validation](docs/validation.md) for exact provenance and checksums. Documentation-only successors do not represent a new same-SHA test run.

### Historical qualification (superseded)

The pre-migration executable commit `7e095afe6274137104f15caf9cbaef7738d6a9ba` passed 152 static tests, native core, CSI and offline Android preparation. It is preserved as historical evidence, not the current implementation.

### Remaining release gates

Independent native-device acceptance [#12](https://github.com/everhush/vm_interface/issues/12) remains unstarted (0/3). No stable version or release tag has been published. Production identity/dashboard, managed-cloud runtime certification, production migration/backup qualification and conditional hardware features remain outside the verified evaluation scope. See [release checklist](docs/release-checklist.md).
