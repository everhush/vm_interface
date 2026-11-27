# Kubernetes and Vite+ migration record — issue #13

**Candidate:** [`34652dc2fffd585e8e95aac1a2df63b3552da8f8`](https://github.com/everhush/vm_interface/commit/34652dc2fffd585e8e95aac1a2df63b3552da8f8)  
**Status:** implementation staged; exact native core qualification still in progress; CSI and Android preparation passed. This is not an approval to execute issue #12, nor a stable release. The final evidence verdict must be recorded before primary promotion.

## Source inventory

Compared the transferred baseline `d2f4eb11cd1c6084a97021e1c74cde2ffa2a9036` and candidate `34652dc2fffd585e8e95aac1a2df63b3552da8f8` using complete Git trees. Baseline: 219 tracked blobs; candidate: 231 tracked blobs. The baseline contained 65 Python files plus `Dockerfile` and `.dockerignore`. None remains in the candidate. The active manifest/lock use Vite+ 1.8.0, Vite+ core 8.3.8001 and Vitest 5.1.1; no ESLint, typescript-eslint or tsx installed package remains. The Vinext application runtime is retained. The source migration guard checks tracked executable content and dependency/configuration regressions; external OCI registry references are allowed.

The following file-level crosswalk identifies the migrated implementations and tests, including consolidated test modules. It is an inventory, not a substitute for runtime qualification or a proof of equivalence by filename.

| Baseline Python path | Candidate TypeScript path |
| --- | --- |
| `scripts/acquire-image.py` | [`scripts/acquire-image.ts`](../scripts/acquire-image.ts) |
| `scripts/acquire_image.py` | [`scripts/acquire_image.ts`](../scripts/acquire_image.ts) |
| `scripts/android_fixture.py` | [`scripts/android-fixture.ts`](../scripts/android-fixture.ts) |
| `scripts/android_guest_transfer.py` | [`scripts/android-guest-transfer.ts`](../scripts/android-guest-transfer.ts) |
| `scripts/apk_manifest_check.py` | [`scripts/apk-manifest-check.ts`](../scripts/apk-manifest-check.ts) |
| `scripts/check-rbac-ci.py` | [`scripts/check-rbac-ci.ts`](../scripts/check-rbac-ci.ts) |
| `scripts/check-runner-space.py` | [`scripts/check-runner-space.ts`](../scripts/check-runner-space.ts) |
| `scripts/ci_loopback_relay.py` | [`scripts/ci_loopback_relay.ts`](../scripts/ci_loopback_relay.ts) |
| `scripts/cirros_screen.py` | [`scripts/cirros-screen.ts`](../scripts/cirros-screen.ts) |
| `scripts/device-preflight.py` | [`scripts/device-preflight.ts`](../scripts/device-preflight.ts) |
| `scripts/device_profile.py` | [`scripts/device_profile.ts`](../scripts/device_profile.ts) |
| `scripts/e2e-api-control-proof.py` | [`scripts/e2e-api-control-proof.ts`](../scripts/e2e-api-control-proof.ts) |
| `scripts/e2e-api-functional-proof.py` | [`scripts/e2e-api-functional-proof.ts`](../scripts/e2e-api-functional-proof.ts) |
| `scripts/e2e-csi-growth.py` | [`scripts/e2e-csi-growth.ts`](../scripts/e2e-csi-growth.ts) |
| `scripts/e2e-data-disks.py` | [`scripts/e2e-data-disks.ts`](../scripts/e2e-data-disks.ts) |
| `scripts/e2e-exchange.py` | [`scripts/e2e-exchange.ts`](../scripts/e2e-exchange.ts) |
| `scripts/e2e-idle.py` | [`scripts/e2e-idle.ts`](../scripts/e2e-idle.ts) |
| `scripts/e2e-iso.py` | [`scripts/e2e-iso.ts`](../scripts/e2e-iso.ts) |
| `scripts/e2e-media.py` | [`scripts/e2e-media.ts`](../scripts/e2e-media.ts) |
| `scripts/e2e-persistent.py` | [`scripts/e2e-persistent.ts`](../scripts/e2e-persistent.ts) |
| `scripts/e2e-recovery.py` | [`scripts/e2e-recovery.ts`](../scripts/e2e-recovery.ts) |
| `scripts/e2e-smoke.py` | [`scripts/e2e-smoke.ts`](../scripts/e2e-smoke.ts) |
| `scripts/evidence_frames.py` | [`scripts/evidence-frames.ts`](../scripts/evidence-frames.ts) |
| `scripts/fetch-pinned-media.py` | [`scripts/fetch-pinned-media.ts`](../scripts/fetch-pinned-media.ts) |
| `scripts/iso_marker.py` | [`scripts/iso-marker.ts`](../scripts/iso-marker.ts) |
| `scripts/kvm_capacity.py` | [`scripts/kvm_capacity.ts`](../scripts/kvm_capacity.ts) |
| `scripts/linux_showcase_fixture.py` | [`scripts/linux-showcase-fixture.ts`](../scripts/linux-showcase-fixture.ts) |
| `scripts/media_http.py` | [`scripts/media-http.ts`](../scripts/media-http.ts) |
| `scripts/prepare_android.py` | [`scripts/prepare-android.ts`](../scripts/prepare-android.ts) |
| `scripts/prepared_android.py` | [`scripts/prepared-android.ts`](../scripts/prepared-android.ts) |
| `scripts/probe-virtiofs-ci.py` | [`scripts/probe-virtiofs-ci.ts`](../scripts/probe-virtiofs-ci.ts) |
| `scripts/provision_sources.py` | [`scripts/provision_sources.ts`](../scripts/provision_sources.ts) |
| `scripts/screen_targets.py` | [`scripts/screen-targets.ts`](../scripts/screen-targets.ts) |
| `scripts/showcase-native.py` | [`scripts/showcase-native.ts`](../scripts/showcase-native.ts) |
| `scripts/showcase_inputs.py` | [`scripts/showcase-inputs.ts`](../scripts/showcase-inputs.ts) |
| `scripts/test_acquire_image.py` | [`tests/acquire-image.test.ts`](../tests/acquire-image.test.ts) |
| `scripts/test_admission_policy.py` | [`tests/admission-policy.test.ts`](../tests/admission-policy.test.ts) |
| `scripts/test_android_guest_transfer.py` | [`tests/android-guest-transfer.test.ts`](../tests/android-guest-transfer.test.ts) |
| `scripts/test_apk_manifest_check.py` | [`tests/android-archive.test.ts`](../tests/android-archive.test.ts) |
| `scripts/test_ci_loopback_relay.py` | [`tests/ci-loopback-relay.test.ts`](../tests/ci-loopback-relay.test.ts) |
| `scripts/test_cirros_screen.py` | [`tests/cirros-screen.test.ts`](../tests/cirros-screen.test.ts) |
| `scripts/test_device_profile.py` | [`tests/device-profile.test.ts`](../tests/device-profile.test.ts) |
| `scripts/test_evidence_frames.py` | [`tests/evidence-frames.test.ts`](../tests/evidence-frames.test.ts) |
| `scripts/test_evidence_source.py` | [`tests/evidence-source.test.ts`](../tests/evidence-source.test.ts) |
| `scripts/test_iso_marker.py` | [`tests/iso-marker.test.ts`](../tests/iso-marker.test.ts) |
| `scripts/test_kvm_capacity.py` | [`tests/kvm-capacity.test.ts`](../tests/kvm-capacity.test.ts) |
| `scripts/test_linux_showcase_fixture.py` | [`tests/linux-showcase-fixture.test.ts`](../tests/linux-showcase-fixture.test.ts) |
| `scripts/test_media_http.py` | [`tests/media-http.test.ts`](../tests/media-http.test.ts) |
| `scripts/test_prepare_android.py` | [`tests/android-archive.test.ts`](../tests/android-archive.test.ts) |
| `scripts/test_provision_sources.py` | [`tests/provision-sources.test.ts`](../tests/provision-sources.test.ts) |
| `scripts/test_screen_targets.py` | [`tests/screen-targets.test.ts`](../tests/screen-targets.test.ts) |
| `scripts/test_showcase_inputs.py` | [`tests/showcase-inputs.test.ts`](../tests/showcase-inputs.test.ts) |
| `scripts/test_verify_csi_evidence.py` | [`tests/verify-csi-evidence.test.ts`](../tests/verify-csi-evidence.test.ts) |
| `scripts/test_verify_media_evidence.py` | [`tests/verify-media-evidence.test.ts`](../tests/verify-media-evidence.test.ts) |
| `scripts/test_verify_network_evidence.py` | [`tests/verify-network-evidence.test.ts`](../tests/verify-network-evidence.test.ts) |
| `scripts/test_virtiofs_probe.py` | [`tests/virtiofs-probe.test.ts`](../tests/virtiofs-probe.test.ts) |
| `scripts/verify-evidence.py` | [`scripts/verify-evidence.ts`](../scripts/verify-evidence.ts) |
| `scripts/verify_csi_evidence.py` | [`scripts/verify_csi_evidence.ts`](../scripts/verify_csi_evidence.ts) |
| `scripts/verify_media_evidence.py` | [`scripts/verify_media_evidence.ts`](../scripts/verify_media_evidence.ts) |
| `scripts/verify_network_evidence.py` | [`scripts/verify_network_evidence.ts`](../scripts/verify_network_evidence.ts) |
| `scripts/write-showcase-scenario.py` | [`scripts/write-showcase-scenario.ts`](../scripts/write-showcase-scenario.ts) |
| `showcases/windows/build-catalog-iso.py` | [`showcases/windows/build-catalog-iso.ts`](../showcases/windows/build-catalog-iso.ts) |
| `showcases/windows/build-driver-iso.py` | [`showcases/windows/build-driver-iso.ts`](../showcases/windows/build-driver-iso.ts) |
| `showcases/windows/test_catalog_iso.py` | [`tests/windows-driver-iso.test.ts`](../tests/windows-driver-iso.test.ts) |
| `showcases/windows/test_driver_iso.py` | [`tests/windows-driver-iso.test.ts`](../tests/windows-driver-iso.test.ts) |

The former daemon-specific build files are replaced by [daemonless OCI build](../scripts/build-oci.sh), [OCI tools](../scripts/install-oci-tools.sh) and [Kubernetes deployment manifests](../infra/app.yaml). Local K3s/containerd remains the native evaluation profile. [Managed Kubernetes](managed-kubernetes.md) describes explicit kubeconfig/context, registry digest and KVM/CNI/CSI prerequisites for EKS/AKS; no managed runtime certification or paid provisioning is asserted.

## Exact-candidate qualification

| Gate | Run | Verdict |
| --- | --- | --- |
| Locked Vite+ static | [46077697248](https://github.com/everhush/vm_interface/actions/runs/46077697248) | PASS: 158/158 tests in 59 files; zero failed/skipped/todo; format, type-aware lint/check, build, loader and source guard passed. |
| Native core | [46077980605](https://github.com/everhush/vm_interface/actions/runs/46077980605) | In progress; isolated actual KVM and OCI deployment passed. Final verdict pending. |
| Real CSI expansion | [46078053324](https://github.com/everhush/vm_interface/actions/runs/46078053324) | PASS: real expandable CSI, actual VirtioFS guest capacity growth, unchanged PVC/DataVolume identities, 206 matching HTTP status pairs and both admission denials. |
| Android inputs | [46077983994](https://github.com/everhush/vm_interface/actions/runs/46077983994) | PASS: pinned disks, signed APK and both scenario preflights. Native boot and guest compatibility unverified. |

Independently reviewed archived artifact checksums:

| Artifact | SHA-256 |
| --- | --- |
| [Static report 15236116330](https://github.com/everhush/vm_interface/actions/runs/46077697248/artifacts/15236116330) | `14399d6101b3289da5e1cf87e5fa774fa696a271795c4d8d57e371ef06981c97` |
| [Locked dependencies 15236226055](https://github.com/everhush/vm_interface/actions/runs/46077697248/artifacts/15236226055) | `caa125fb59cc49be4c4a59c364deb45cf9791790c6d1da92c0e160c811b6d38c` |
| [CSI evidence 15235639964](https://github.com/everhush/vm_interface/actions/runs/46078053324/artifacts/15235639964) | `7f434757b857a2d235692176f870da43085c7e18f933c3c9d7d3e20dcf8b801f` |
| [Android inputs 15235503423](https://github.com/everhush/vm_interface/actions/runs/46077983994/artifacts/15235503423) | `6d5c29a1e48fb0c787ad97605040208356580f9d446f73be89f3ef17bebba80b` |

Independent CSI review matched the actual guest capacity 1020702720→2077073408 bytes; unchanged boot and exchange PVC and boot DataVolume identities; boot claim 6828998001→8Gi and exchange claim 1Gi→2Gi. The 4096-byte guest challenge, before/after guest measurements and bundle manifest/member SHA-256 values matched; bundle SHA-256 `a91953f13bf58d5f6895600eb65d8343cc141fb64d1013a4f877c2f0e5c92544`. All 206 redacted HTTP status pairs matched, including required ownership/version/shrink denials and both Kubernetes admission denials. Boot virtual disk and guest boot filesystem growth are not claimed.

The core workflow's static report and locked dependencies were independently compared against the standalone static qualification: all 158 test identities/statuses match and the lock bytes are identical (SHA-256 `d011617a998a5deea42f25c0a0ea6eb697e427f520bac2dda68738f6ea9fbc4e`).

The final native evidence must bind to the same candidate and run identities; verify original video, actual guest bytes, storage and network identities, and complete cleanup. Do not mix historical artifacts or count hosted qualification as an independent device review. #12 remains unstarted (0/3). Do not promote the candidate until its final native results and independent artifact review are recorded.
