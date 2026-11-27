# Kubernetes and Vite+ migration record — issue #13

**Candidate:** [`34652dc2fffd585e8e95aac1a2df63b3552da8f8`](https://github.com/everhush/vm_interface/commit/34652dc2fffd585e8e95aac1a2df63b3552da8f8)  
**Status:** Exact hosted qualification and independent artifact review completed on 2026-11-27 UTC. Eligible for source-preview promotion and issue #12 validation-only handoff; not a stable release or independent device acceptance.

## Source inventory

Compared the transferred baseline `d2f4eb11cd1c6084a97021e1c74cde2ffa2a9036` and candidate `34652dc2fffd585e8e95aac1a2df63b3552da8f8` using complete Git trees. Baseline: 219 tracked blobs; candidate: 231 tracked blobs. The baseline contained 65 Python files plus `Dockerfile` and `.dockerignore`. None remains in the candidate. The active manifest/lock use Vite+ 1.8.0, Vite+ core 8.3.8001 and Vitest 5.1.1; no ESLint, typescript-eslint or tsx installed package remains. The Vinext application runtime is retained. The source migration guard checks tracked executable content and dependency/configuration regressions; external OCI registry references are allowed.

The original 23 Python test modules define 59 test methods. The corresponding 21 TypeScript suites contain 60 passing cases in the independently reviewed exact static report, with 98 further passing cases in the other suites (158 total). Some cases are grouped, split or expanded, so count comparison is not proof of assertion-by-assertion equivalence. The Android archive/APK and Windows catalog/driver tests retain their negative input, exact-byte and signer/metadata checks; native Linux guest archive, pointer and persistence checks now use actual Node runtime evidence.

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
| Native core | [46077980605](https://github.com/everhush/vm_interface/actions/runs/46077980605) | PASS: all 13 native API stages, actual restart recovery, VirtioFS compatibility probe and all evidence verifiers. Independent archive review passed. |
| Real CSI expansion | [46078053324](https://github.com/everhush/vm_interface/actions/runs/46078053324) | PASS: real expandable CSI, actual VirtioFS guest capacity growth, unchanged PVC/DataVolume identities, 206 matching HTTP status pairs and both admission denials. |
| Android inputs | [46077983994](https://github.com/everhush/vm_interface/actions/runs/46077983994) | PASS: pinned disks, signed APK and both scenario preflights. Native boot and guest compatibility unverified. |

Independently reviewed archived artifact checksums:

| Artifact | SHA-256 |
| --- | --- |
| [Static report 15236116330](https://github.com/everhush/vm_interface/actions/runs/46077697248/artifacts/15236116330) | `14399d6101b3289da5e1cf87e5fa774fa696a271795c4d8d57e371ef06981c97` |
| [Locked dependencies 15236226055](https://github.com/everhush/vm_interface/actions/runs/46077697248/artifacts/15236226055) | `caa125fb59cc49be4c4a59c364deb45cf9791790c6d1da92c0e160c811b6d38c` |
| [Core evidence 15237129511](https://github.com/everhush/vm_interface/actions/runs/46077980605/artifacts/15237129511) | `cb501ac76070d63f1e0d7607861f3971fbb6242e46b7ff96f94e47c6676af3fb` |
| [CSI evidence 15235639964](https://github.com/everhush/vm_interface/actions/runs/46078053324/artifacts/15235639964) | `7f434757b857a2d235692176f870da43085c7e18f933c3c9d7d3e20dcf8b801f` |
| [Android inputs 15235503423](https://github.com/everhush/vm_interface/actions/runs/46077983994/artifacts/15235503423) | `6d5c29a1e48fb0c787ad97605040208356580f9d446f73be89f3ef17bebba80b` |

Independent CSI review matched the actual guest capacity 1020702720→2077073408 bytes; unchanged boot and exchange PVC and boot DataVolume identities; boot claim 6828998001→8Gi and exchange claim 1Gi→2Gi. The 4096-byte guest challenge, before/after guest measurements and bundle manifest/member SHA-256 values matched; bundle SHA-256 `a91953f13bf58d5f6895600eb65d8343cc141fb64d1013a4f877c2f0e5c92544`. All 206 redacted HTTP status pairs matched, including required ownership/version/shrink denials and both Kubernetes admission denials. Boot virtual disk and guest boot filesystem growth are not claimed.

The core workflow's static report and locked dependencies were independently compared against the standalone static qualification: all 158 test identities/statuses match and the lock bytes are identical (SHA-256 `d011617a998a5deea42f25c0a0ea6eb697e427f520bac2dda68738f6ea9fbc4e`).

## Independent native core artifact review

All 13 named native API stages exited zero; actual KVM/OCI deployment, isolation, persistent disks, data disk import/export, Fedora 44 native application, CDI import, BIOS/UEFI ISO boot, VNC, original control recording, keyboard/pointer ownership and hard reset, private TCP tunneling, recording authorization, guest exchange and idle-stop passed. Restart recovery, the isolated infrastructure VirtioFS compatibility probe and all hosted evidence verifiers passed. Independent archive review verified the exact source/run, ZIP SHA-256 `cb501ac76070d63f1e0d7607861f3971fbb6242e46b7ff96f94e47c6676af3fb`, CRC and original recording frames, exact guest bytes and cleanup. Core artifact [15237129511](https://github.com/everhush/vm_interface/actions/runs/46077980605/artifacts/15237129511).

| Original recording | Duration | Bytes | Matching API calls | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| Control, H.264 | 21.5 s | 809056 | 127 | `e93a0329b2d8448849c1a1e3eec83d77746e0b988833617e46369daa5a692b1c` |
| Fedora functional, H.264 | 18.5 s | 79090 | 223 | `5cdc413484cc0c3d81f2ba0290ca055ded0e2b554708fecdabeaa320466216a9` |
| Recording lifecycle, H.264 | 7.5 s | 1065014 | — | `b048a22b8dce731f9caba266734d2ec19b49afc1967a2ecaf0ff885858d83405` |

Independently decoded all original MP4s and matched control/functional original pixels and chronological exact OCR markers. Actual Fedora 44 x86_64 installed and ran the exact TypeScript guest application and ZIP writer (Git blob identities checked). Node v24.22.3 guest runtime receipt and seven actual runtime upload chunks matched. Verified 4096-byte challenge SHA-256 `7b5b831110f20860bc352c8596ae1397d6ec0a0dc37251f905dd1b0d9a9e8756`, actual computed result, ZIP archive bytes, QEMU USB tablet receipt, original/clone byte inversion, separate clone PVC, replacement VMI and visible reboot persistence. Verified four native CDI modes (35 direct, 48 resumable, 45 dual, 111 URL/registered; 239 matching status pairs), actual login screenshots, exact pins/cache and registered-source independence; network 47 HTTP/upgrade calls and identical native guest/relay response bodies. Independently checked BIOS/UEFI exact boot marker and five original input/reset screenshots, recorded authorization/deletion, real exchange challenge and 4117-byte result (bundle SHA-256 `393395c5dbd49d85b726328419fcad3c657af09d5af1191982ebc3c0dee755f3`), recovery, idle, zero data-disk quota on cleanup and no remaining guest VM/VMI or guest PVCs.

Android preparation archive verified the pinned disk manifests, both scenario preflight hashes and APK SHA-256 `c7e7743df447e1233bf442d41913b9fc84398e6c3781f9ef81f243779cb32074` (12709 bytes); APK package/version 3.0/3, hosted v1/v2/v3 signatures and local JAR signature verified. Disposable signing identity only, not production signing approval. Actual guest boot and compatibility remain unverified.

Supporting diagnostic core [46077339894](https://github.com/everhush/vm_interface/actions/runs/46077339894) on `21de1b3c1eb460dac0e3f98ec906838bf9a0dd9f` also passed all native stages and independent review, but it is not the final evidence source. Exact-candidate results above govern handoff.

## Handoff boundary

All required hosted gates passed on the identical executable commit. Documentation-only descendants are not new same-SHA test runs; their complete tree comparison must leave executable source, tests, dependency lock, CI and infrastructure unchanged. Use the exact tested SHA for #12. Do not count hosted qualification as an independent device review. #12 remains unstarted (0/3) and requires clean independent x86_64 Linux and native AArch64 Android devices. Managed EKS/AKS runtime, Android guest boot, boot virtual disk/filesystem growth, and conditional hardware features are not certified by this record. No paid provisioning, schedules, stable release or binary publication.
