# Qualification and reproducibility record

**Date:** 2026-11-27. **Hosted-tested source:** [`7e095afe6274137104f15caf9cbaef7738d6a9ba`](https://github.com/imxade/vm_interface/commit/7e095afe6274137104f15caf9cbaef7738d6a9ba). **Status:** ready for #12 independent native-device acceptance; not certified for production or stable release. The main source distribution adds license and documentation after that source commit. The hosted run evidence refers to the exact SHA above, not a later documentation commit.

## Exact hosted results

| Workflow | Result | Evidence |
| --- | --- | --- |
| [45954535380 — core](https://github.com/xad3play/vm_interface/actions/runs/45954535380) | 93 TypeScript + 59 Python tests, lint/typecheck/build; 13 native stages exit 0 and additional recovery/compatibility/verifiers pass | [15180683180](https://github.com/xad3play/vm_interface/actions/runs/45954535380/artifacts/15180683180) |
| [45954542680 — CSI](https://github.com/xad3play/vm_interface/actions/runs/45954542680) | Real expandable CSI driver; actual exchange growth, unchanged PVC identities, 199 matching HTTP statuses | [15178751551](https://github.com/xad3play/vm_interface/actions/runs/45954542680/artifacts/15178751551) |
| [45954551058 — Android preparation](https://github.com/xad3play/vm_interface/actions/runs/45954551058) | Pinned media, APK v3 signing v2/v3, both scenario hashes; native compatibility **not verified** | [15177888333](https://github.com/xad3play/vm_interface/actions/runs/45954551058/artifacts/15177888333) |

ZIP SHA-256 checksums (original downloaded workflow artifacts):

| Artifact | SHA-256 |
| --- | --- |
| Core | `fb7dc39381595df708e269da2e867be80de74a1001686cee45fefda1a873c747` |
| CSI | `e9cfe6e79c4ea1c1dd0bbe6ae146e77d30c6830a647bb6e953267d6d19bb3362` |
| Android | `e3448aa6fffff00440eb3b3b03640941afbd0cfbbe49242c2a5d5a64e7a9f54a` |

## Original guest video and actual results

| Recording | Duration | Bytes | Matching API calls | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| Control, H.264 | 22.5 s | 809484 | 117 | `d52561b2d860b4be5a72b513dd13d44f8d9ff74e451d825e8176f2f2cfc9d2f0` |
| Fedora functional, H.264 | 19.5 s | 52379 | 219 | `56cae71b94460970d932154cf3f9601d66c21f8c1a28a8154ba31e481a26119c` |

Original MP4s (not derived presentations) were independently fully decoded and their SHA-256 values, traces and ordered visible guest markers matched. Fedora 44 x86_64 installed and ran the uploaded application; actual 4096-byte challenge computation, guest archive, QEMU USB tablet absolute XY and left-button receipt, independent clone-byte inversion, persistent PVC identities and replacement VMI after cold resize/reboot were reviewed. Media verifier matched 244 status pairs across direct (36), resumable (54), dual (48) and URL/registry (106), guest-login screenshots and distinct owned PVC identities. Network verifier recorded 57 HTTP/upgrade calls with bounded startup 502 retries and verified actual guest and relay response bytes. Input takeover, automation denial, observer denial, key revocation, idempotent batch replay, hard reset, BIOS/UEFI, exchange bundle, idle and API restart recovery passed. Storage quota returned to zero; no guest VM/VMI or guest PVC remained (service PVCs remain).

CSI guest exchange capacity increased from 1,020,702,720 to 2,077,073,408 bytes, with unchanged boot/exchange claim identities and verified guest input/result bytes. Boot PVC request/capacity growth was observed, not boot virtual disk or guest filesystem expansion. Android preparation APK SHA-256: `1e6896e675375517908dbf58433189e31b876c670b91734e298f51e60f5d64cc`; both input preflight reports deliberately mark `guestCompatibilityVerified=false`.

## Reproduction

Run [the device guide](device-validation.md) on authorized disposable equipment, not an existing cluster. For the exact hosted implementation use `git checkout 7e095afe6274137104f15caf9cbaef7738d6a9ba`. To inspect retained core artifacts without KVM, extract the archive into a private directory and run:

```sh
 # Use the verifier from an exact checkout of historical candidate 7e095afe6274137104f15caf9cbaef7738d6a9ba.
node scripts/verify_media_evidence.ts --root /path/to/core-artifact --commit 7e095afe6274137104f15caf9cbaef7738d6a9ba --run-id 45954535380
node scripts/verify_network_evidence.ts --root /path/to/core-artifact --commit 7e095afe6274137104f15caf9cbaef7738d6a9ba --run-id 45954535380
node scripts/verify_csi_evidence.ts --root /path/to/csi-artifact --commit 7e095afe6274137104f15caf9cbaef7738d6a9ba
```

Verify original artifact hashes and inspect actual guest frames and returned bytes. Artifact verifiers do not independently certify hardware. Private CI access and artifact retention may limit availability; no raw logs, media or guest data are redistributed here. Historical iterations and failures are preserved in [implementation.md](implementation.md). [Machine-readable requirement ledger](requirements.json).

## Remaining acceptance (issue #12)

- Independent clean x86_64 KVM core and Linux application validation.
- Native AArch64 Linux KVM with real ARM64 Android boot/display, APK installation and execution, authorized VirtioFS/SAF or authenticated private ADB transfer, actual result, persistent resize and original recording.
- Conditional eligible-device tests for hardware/storage profiles; do not advertise unsupported GPU, live migration, live resize, virtio-mem or snapshots.
- Three consecutive comprehensive reviewed independent-device passes on the approved exact candidate; **0/3**, not started. Failures route back to implementation issues.

Hosted qualification is not production authentication, production security audit, OS licensing approval, EKS validation or general hardware conformance. The README describes an evaluation preview; no stable release tag or publication is authorized by this record.
