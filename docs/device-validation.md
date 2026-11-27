# Device validation handoff

> **Current qualification (2026-11-27):** the hosted core, native CSI evaluation and Android offline preparation all passed on exact commit `7e095afe6274137104f15caf9cbaef7738d6a9ba`. #12 is ready but independent device acceptance remains 0/3. See [validation.md](validation.md). The instructions below are for authorized disposable devices; this is not a certified release.

**This is not a certified release.** Hosted x86_64 and offline Android input checks passed. Independent device acceptance, including native ARM64 guest runtime, remains essential. Run the locked checks on each validation checkout; do not use on production systems.

## 1. Non-virtualization checks

On a Linux machine with network access, Git, Node.js 24, npm, Bash, curl, FFmpeg/ffprobe with `libx264` and `drawtext`, Tesseract English language data, and DejaVu fonts:

```sh
git clone https://github.com/imxade/vm_interface.git
cd vm_interface
git checkout 7e095afe6274137104f15caf9cbaef7738d6a9ba
bash scripts/device-validate.sh checks
```

This does not require KVM. It runs typecheck/lint/unit/build and shell syntax checks. The CI-only fork `xad3play/vm_interface` executes these checks against exact synchronized upstream commits. The separate static CI workflow is reserved for the preparation branch; the implementation branch runs static and KVM checks in one workflow. Upstream job execution is disabled by repository guard. Do not interpret its success as guest conformance.

## 2. Dedicated device

Use a **disposable Linux device**, not an existing cluster, shared persistent self-hosted runner or a personal production PC. Review the checkout before running it. Require a matching x86_64 or AArch64 processor, actual /dev/kvm access, Buildah, sudo, Node 24, a C compiler for the KVM ioctl probe, FFmpeg/ffprobe, Tesseract, skopeo and distribution packages used by probes. Core preflight requires >=6 GiB RAM and >=35 GiB free root storage; large media profiles require >=12 GiB and >=100 GiB free. These are conservative starting requirements, not guaranteed sufficient. No software fallback or cloud purchase.

```sh
sudo "$(command -v node)" scripts/device-preflight.ts --architecture amd64
bash scripts/device-validate.sh core --confirm-disposable
```

The script verifies the exact K3s installer, matching native binary and KubeVirt/CDI/CNPG release manifests against `infra/provision-sources.json` before execution (see `evidence/provision-sources.json`; integrity is not full publisher signature or container-image attestation). It provisions K3s and the pinned operator versions, deploys Vinext, generates ephemeral local test account secrets, port-forwards only to localhost, and exercises actual product API tests. The same per-stage supervised HTTP and certificate-verified WSS transports used in hosted CI are used on the disposable device. A transport restart never automatically retries a mutating API operation. It retains the cluster for operator inspection/disposal. Do not rerun over the same installation; use a clean disposable device per validation iteration. It does not register a persistent GitHub runner. KVM API creation alone does not establish actual native acceleration, particularly inside an emulated outer EL2 guest.

## 3. Historical optional Windows x64 (not a readiness gate)

- Obtain authorized Windows Server 2022 Desktop Experience ISO from https://www.microsoft.com/en-us/evalcenter/evaluate-windows-server-2022 (evaluation terms, registration/activation, expiry apply). Retain actual version, authorized source, digest, size and terms acknowledgement. Use publisher checksum where available; a locally computed digest is integrity, not authenticity. Do not bypass activation or supply a shared password.
- Use client-owned authorized installer preparation, including signed virtio-win/WinFsp packages if needed, and qualified VirtioFS driver mount. Sources: https://kubevirt.io/user-guide/compute/windows_virtio_drivers/ and https://virtio-win.github.io/Knowledge-Base/Virtiofs-qs . Driver bootstrap and Windows guest compatibility are **not yet verified**. A 7-Zip x64 EXE from https://www.7-zip.org/download.html is the software fixture. Record its exact version and digest.
- Create a client JSON scenario matching the actual installer/desktop version. Setup must install Windows, handle authorized license/login through a human checkpoint without recording it, mount the exchange tag on an assigned drive (default X:), set boot priority to system, and leave an authorized elevated PowerShell prompt. The test script uploads the EXE and its own proof.ps1 via API, invokes the PowerShell fixture through API keys, verifies actual archive create/test/extract, opens 7-Zip GUI, checks exact returned bytes and retrieves a playable recording. The script does not disable guest execution policy; permit the client script using normal authorized Windows policy. No fabricated screen coordinates.
- Run on a clean x86 device:

```sh
bash scripts/device-validate.sh windows --confirm-disposable \
  --media /path/to/authorized.iso --media-sha256 <verified-sha256> \
  --source 'Microsoft authorized evaluation source' --version <exact-version> \
  --software /path/to/7zip-x64.exe --software-sha256 <verified-sha256> \
  --scenario /path/to/windows-scenario.json --system-gib 40 \
  --authorize-media --record-consent
```

## 3a. Mandatory Linux x86_64 showcase

The owner replaced Windows with Linux on 2026-11-25. Use the digest-pinned Fedora KubeVirt image in the API catalog; CDI imports it into persistent storage. Run the native core device workflow, which now includes the full Linux application showcase:

```sh
bash scripts/device-validate.sh core --confirm-disposable
node scripts/verify-evidence.ts --root evidence --profile linux
```

The client generates an exact reproducible application ZIP, uploads it and a random challenge through the product file API, then sends a visible install/launch command through the leased input API. The guest verifies package digest, installs the application on its system disk, creates and tests an archive of actual challenge bytes, publishes output and checksum, and emits a visible marker during consented recording. The client retrieves original MP4, verifies marker frames, retrieves both result and archive, performs cold CPU/RAM resize and restart, checks new VMI identity and original PVC UIDs, installed app persistence and exact file bytes. The verifier checks software package, challenge, archive and trace independently. No Windows registration or driver files are required. Hosted Fedora x86_64 functional qualification passed; independent device reproduction remains pending.

## 4. Native Android ARM64

Research candidates include official AOSP Cuttlefish ARM64 (https://source.android.com/docs/devices/cuttlefish/get-started) and LineageOS QEMU virtual machine targets (https://github.com/jqssun/android-lineage-qemu). Their multi-disk/boot/graphics layout is not automatically compatible with KubeVirt. Use an authorized, digest-verified **prepared UEFI ARM64 virtio disk** qualified for the exact KubeVirt device profile; no x86 Android, external Cuttlefish manager, emulated EL2 substitution, or security-policy bypass. Driver and SAF exchange access must be validated; this is an unresolved guest qualification task, not simply a switch on a runner.

With an authorized Android SDK and JDK, build the included test APK:

```sh
bash showcases/android/build-apk.sh ./proof.apk
```

The APK displays actual supported ABI and Android SDK, requires arm64-v8a, has a button-triggered SHA256 computation, and exports result and checksum through Android's native Storage Access Framework. The client scenario must install the uploaded APK through authorized Android UI, launch it, click Compute, export the two documents to the mounted exchange directory, and return to the visible APKCOMPLETE arm64-v8a screen. Do not enable insecure ADB or weaken SELinux to force the result.

```sh
bash scripts/device-validate.sh android --confirm-disposable \
  --media /path/to/qualified-arm64.qcow2 --media-sha256 <verified-sha256> \
  --source '<authorized-source>' --version <exact-version> \
  --software ./proof.apk --software-sha256 <verified-sha256> \
  --scenario /path/to/android-scenario.json --system-gib 16 \
  --authorize-media --record-consent
```

## 5. Scenario format

Each scenario is an external client file, not a mandatory backend workflow. JSON fields: setup (array), application (array), beforeMarker, afterMarker, resultName ("result.txt"), expectedResultSha256 (fixed fixture bytes, calculate with SHA256). Each action is a single-key object: wait ({text,seconds}), delay (seconds), text (printable ASCII, never credentials), keys (X11 keysyms pressed together), click ([x,y] at actual display resolution), human (description, setup only), system-boot (true, Windows setup only). Use screen inspection and exact-version scenario files; screenshots are not collected during human credential entry. Recording is capped at 120 seconds per segment; qualify that application sequence fits, or explicitly revise and validate segmentation. Never pretend an unfinished run is complete.

Expected Windows output: ASCII "VM Interface Windows 7-Zip functional proof" followed by LF. Expected Android output: UTF-8 "VM Interface Android APK functional proof" followed by LF, then `challenge-sha256:` plus the lower-case SHA256 of the fresh 4096-byte input and a final LF. The latter must show APKCOMPLETE arm64-v8a. Input markers/after markers are real OCR assertions and must not be inserted into video.

## 6. Evidence

Core proof folders contain platform-recording.mp4, real screenshots, redacted HTTP trace, verification.json and a separately labelled derived presentation. Native showcases produce the same evidence plus output bytes and media/software digests. Preserve original MP4; verify SHA256 and full H264 decode; inspect actual frames and guest results. A static presentation or synthetic video is not evidence. Review failures and rerun after corrections. The primary source preview is consolidated; no stable release until full applicable gates and three comprehensive reviewed passes, unless the owner explicitly changes release policy.

To verify already downloaded evidence independently (no KVM needed): `node scripts/verify-evidence.ts --root evidence --profile core --commit <approved-sha>` or `--profile all --commit <approved-sha>` for the three mandatory proof folders. All evidence in a comprehensive review must use the same exact commit; core control and functional evidence must come from the same execution. Assemble a private reviewed evidence set with the original three proof directories (control, functional and android) under one root for `--profile all`; preserve separate device/run provenance and never replace existing files to conceal a failure. Use the [acceptance record template](acceptance-record.md) for each independent review. This requires original recordings, hashes and reported assertions; it does not certify hardware or replace manual review of actual guest frames. Historical screenshot-only evidence must fail this gate.

### Pinned two-disk Android media (offline qualified; native boot pending)

The LineageOS 23.2 ARM64 bundle from release v2026.10.18 passed publisher-attestation verification, exact archive SHA256 and QCOW2 checks on fork run 45623125031. The signed proof APK was built and checked in the same job. That initial artifact is historical. For the current exact-candidate preparation, use [run 45954551058 and artifact 15177888333](https://github.com/xad3play/vm_interface/actions/runs/45954551058/artifacts/15177888333), the committed pinned manifests, and the [validation record](validation.md). This does not certify boot or the exchange mount.

Use an authorized SDK/image and run the acquisition workflow or reproduce its steps using scripts/fetch-pinned-media.ts, scripts/qualify-android-media.sh and the pinned sources. Use vda as --media and vdb as --auxiliary-media with the matching hashes and capacities in the disk manifest (6 GiB and 18 GiB respectively). No bundled NVRAM or unsigned recovery is imported. The ARM64 showcase explicitly selects `storage.exchangeTag: share`, matching the LineageOS virtio-common fstab (`share /mnt/vendor/shared virtiofs`); the backend claim stays account-owned. The source tree is corroboration, not proof that the pinned build mounts or exposes it through SAF. The large-media disposable profile reserves a 20 GiB staging PVC, caps staged data at 16 GiB and verifies API/reconciler settings. Verify native boot, effective tag, and user-authorized SAF read/write without bypassing signatures or SELinux.

### Windows driver media (offline qualified; guest installation pending)

The official virtio-win 0.1.302-1 ISO is pinned by exact SHA256. The two tested standalone VirtIO MSI files were unsigned and rejected. Do not use them. The signed Windows Server 2022 INF/SYS catalog, independently signed VirtioFS service, and signed WinFsp MSI were verified in fork run 45624621225. Driver ISO construction and full byte readback passed in run 45625087154, artifact 15028411663. These runs do not certify guest installation.

Run scripts/qualify-windows-catalog.ps1 on Windows against the pinned media. Then, on a Linux host with xorriso, fetch the pinned virtioISO and winfsp using scripts/fetch-pinned-media.ts and build the authorized driver ISO:

```sh
node showcases/windows/build-catalog-iso.ts --authorized --iso /path/to/virtio-win.iso \
  --winfsp /path/to/winfsp.msi --report /path/to/driver-catalog-report.json --output VMDRIVERS.iso
```

Retain the actual output digest, not a digest from a different build (ISO metadata can vary). Add --auxiliary-media /path/to/VMDRIVERS.iso --auxiliary-sha256 <actual-output-sha256> --auxiliary-gib 1 to the Windows command. The image contains bootstrap.ps1, which verifies exact component bytes and signer identities, uses normal signed driver installation and requires the actual API-uploaded challenge before VMDRIVERSREADY. The older MSI packager is retained for historical review only; it is not the qualified input path.

Windows media and scenario are historical/optional. Hosted Linux qualification passed; native ARM64 Android and independent device acceptance remain outstanding under ready issue #12.

### Bundled scenario recipes (prepared, not runtime-qualified)
Use `node scripts/write-showcase-scenario.ts windows windows-scenario.json` or `node scripts/write-showcase-scenario.ts android android-scenario.json` to create the concrete client recipe. Windows uses authorized installation and login checkpoints before recording, then actual 7-Zip GUI evidence. Android requires fixture APK version 3.0, adds a post-upload installation and authorized Storage Access Framework directory selection checkpoint, then clicks the exact unique visible Compute proof label using OCR from actual API screenshots. The APK reads the fresh 4096-byte API-uploaded challenge using the user-granted directory, computes its SHA256 and publishes a challenge-bound result/checksum. Version 2.0 static-output evidence is historical only. No fabricated click coordinates or recording of credentials. These prepared recipes still require guest qualification on the exact media; missing mount/provider or ambiguous OCR is an explicit failure, not a fallback. The new APK must be rebuilt and independently signature-checked; version 1.0 artifact is historical only. The prepared Android client rechecks the actual APK signature and package/version metadata using the authorized portable Java apksigner.jar (set ANDROID_HOME to the SDK containing build-tools 34.0.0, APKSIGNER_JAR to its verified JAR, or use apksigner in PATH) and a bounded standard-library binary-manifest reader; no x86-only aapt2 executable is required on ARM64. The adb-saf launch additionally checks native adb before provisioning. If the guest requires the same test RSA key to be reauthorized after a cold restart, the operator may approve it at an unrecorded checkpoint; authentication and SELinux enforcement must remain enabled.

### Standalone Linux device profile

On a separate disposable native x86_64 KVM device, `bash scripts/device-validate.sh linux --confirm-disposable` runs the full Linux application installation, control, archive, recording and cold-resize/reboot proof. It uses the pinned Fedora catalog image and requires no Windows installer, external APK, scenario or licensing credentials. Verify independently with `node scripts/verify-evidence.ts --root evidence --profile linux`.

## Optional CSI storage growth evaluation

The ordinary local-path profile cannot expand PVCs. The API rejects a growth request before changing quota, desired state or PVCs. Do not set allowVolumeExpansion on a non-expanding driver as a substitute.

To evaluate native growth on an authorized clean cluster, an operator must supply a real, CDI/KubeVirt-compatible CSI StorageClass named `vm-expandable` (filesystem, RWO, actual controller/node expansion support and allowVolumeExpansion: true). Configure the API and reconciler with `VM_STORAGE_CLASS=vm-expandable` before creating test VMs; the selected class is stored in their immutable DataVolume templates. Apply `infra/storage-growth.yaml` only to this qualified evaluation environment: it adds narrow namespace PVC patch RBAC and a mandatory admission fence for monotonic storage-only changes to managed claims. The ordinary installation does not grant PVC patch privileges. Never apply this to a production cluster before independent review and qualification.

Use `POST /computers/{id}/storage/plan` then `PATCH /computers/{id}/storage` with a fresh Idempotency-Key and body `{"disk":"system.disk","sizeGiB":4,"expectedResourceVersion":"<current VM resourceVersion>"}` on a halted, converged VM. Disk selectors are system.disk, exchange.disk (both block and VirtioFS), or a named independent data disk. Storage reports the reservation, whether the exact PVC request was submitted, actual CSI capacity convergence, and explicitly false guest-disk/filesystem growth verification flags. Same PVC UID required; shrinking, unknown claims, foreign account, stale version and exceeding quota are refused. If a reserved submission fails, inspect the current state and resubmit exactly the reserved target with a new key and current version; no automatic destructive rollback, recreation or replay of uncertain writes. Start is blocked until the reserved patch has been submitted; filesystem expansion may complete when mounted. Clone/export wait for capacity convergence. This is native PVC expansion evaluation verified with the pinned eligible CSI driver in hosted CI; independent device qualification remains pending. Guest virtual disk, partition and filesystem capacity must be measured separately.

### Exact Android device input preparation and invocation

On an authorized preparation machine with Android SDK 34, JDK, qemu-img and authenticated gh for publisher attestation verification, execute:

```sh
bash scripts/qualify-android-media.sh /absolute/path/to/android-inputs --retain-disks
node scripts/prepared-android.ts /absolute/path/to/android-inputs --preflight-only
```

This verifies the exact pinned archive and both disk hashes against the committed prior qualification manifest, builds/signs APK v3, generates the matching scenario, and validates input only. No KVM, API credentials or guest execution. Keep disks private to the authorized operator; CI artifacts retain only manifest, APK and scenario. On the independent disposable native ARM64 device after explicit #12 readiness, run `node scripts/prepared-android.ts /absolute/path/to/android-inputs --confirm-disposable`. No manual digest substitution required. First-run UI/SAF authorization remains a genuine device checkpoint; no security bypass or synthetic evidence.

### Explicit Android guest-transfer alternative

The pinned LineageOS source uses the VirtioFS tag `share`, mounted at `/mnt/vendor/shared`. This does not prove that Android's ordinary Storage Access Framework (SAF) exposes that vendor mount. Choose the direct VirtioFS scenario first when it is available. For a disposable guest with ordinary authenticated Ethernet ADB (TCP 5555), an alternative can be selected **before** creating the VM:

```sh
node scripts/prepared-android.ts /path/to/prepared --confirm-disposable --transfer adb-saf --authorize-android-debug
```

Requires native platform-tools adb, private TLS WSS tunnel and a human approving the freshly generated guest RSA key. Never enable unauthenticated debugging, root, permissive SELinux or public port forwarding. The client verifies the original API-staged APK and challenge from the halted exchange bundle, installs and transfers those bytes through the authorized tunnel, selects Documents/VMInterface with SAF, and obtains the computed result through that same authenticated guest-transfer path. The report distinguishes this from a direct VirtioFS file download; both require actual video, independent challenge verification and preserved disk identities after cold resize. This route is prepared, not yet native-device-qualified.

The optional CSI lane installs the fail-closed admission policy and binding separately from patch RBAC. Before granting general PVC patch permission to the API identity, it proves actual policy enforcement on an isolated disposable sentinel claim with resource-name-limited RBAC, then rechecks denial on the recording claim. The profile is enabled only after both dry-run denials. Do not manually apply `infra/storage-growth-rbac.yaml` before verifying actual policy enforcement. On a failed qualification the optional RBAC is removed.

For downloaded hosted CSI growth evidence, run `node scripts/verify_csi_evidence.ts --root /path/to/artifact --commit <exact-run-commit>`. The verifier checks actual guest challenge and measurement bytes, the published bundle manifest and member hashes, both admission denials, exact PVC/DataVolume identities and capacities, and matching redacted HTTP statuses. It does not certify hardware or claim guest boot disk/filesystem growth.

The Linux application profile requests an explicit USB tablet only in the pinned amd64 Fedora image. It waits for actual guest tablet absolute-axis events and left-button press/release before computing the result; the verifier checks the challenge-bound receipt, original screenshots and authorized API phases. Hosted USB tablet receipt passed on the pinned Fedora profile. This is not true multitouch or a blanket hardware support claim.

### Authorized public URL acquisition and cache

External downloads remain client-side rather than granting the service arbitrary network egress. Use `node scripts/acquire-image.ts` with an explicitly authorized HTTPS URL, exact hostname allowlist, publisher SHA256 and byte bound. Every redirect is checked, DNS answers must all be public, the TCP destination is pinned to a checked address and TLS authenticates the original hostname; ambient proxies are not used. The optional public-media cache is private to the client and keyed by digest; every hit is rehashed and materialized into a separate file. Never use the public cache for tenant-private images. Submit the resulting bytes to the authenticated media API with declared size/digest and upload or resume/commit; the server never fetches the supplied source string. Native CI tests this with CirrOS 0.6.3, publisher https://download.cirros-cloud.net/0.6.3/SHA256SUMS and exact 21692416-byte release asset, followed by real CDI import and API screenshot. This is not a central cross-tenant artifact registry.

Account-owned registered image API: POST /media-artifacts with {metadata: declared MediaSpec, architecture, licensing} and Idempotency-Key; reserve 64 MiB per item, 256 MiB per account and 512 MiB total in a separate operator-created PVC. PUT /media-artifacts/{id}/file with exact bytes and idempotency key; verified immutable files are not overwritten. GET list/status and DELETE owned artifact. Declare identical metadata and architecture in the destination ComputerSpec, then POST /computers/{id}/media/{slot}/artifact with {artifactId}; the existing CDI path re-verifies bytes/header/capacity and creates an independent VM disk. Deleting the artifact does not delete imported disks. Larger images still use per-VM resumable uploads and optional authorized client cache; no arbitrary backend URL access or cross-tenant deduplication. CI public URL fixture exercises ownership, bad digest, immutability, replay, independent PVCs and deletion. Hosted registry/import qualification passed (run 45954535380); independent-device reproduction remains pending.

For large-media clients, inspect the target declaration/status first and use an HTTP client that can receive an early final HTTP response while uploading (for example `Expect: 100-continue` with curl). Unauthorized, already-imported, replayed or conflicting requests may return before consuming the body. Never infer rejection or success from a TCP reset; inspect the operation/status and do not automatically replay a mutation. The binary CI client retains full-size test inputs and requires the actual HTTP response.

### Recovering a disconnected mutation
Use `GET /api/v1/operations/by-key` with the same account authorization and original `Idempotency-Key` header to retrieve the durable receipt. Missing returns 404 (including other accounts), invalid key 400. This never executes a mutation. Inspect the receipt and resource state; do not submit a fresh key for an unknown operation. The original key must be retained privately. The receipt lookup and health checks do not certify convergence; use the relevant resource/operation status.

For complete native network proof run `node scripts/verify_network_evidence.ts --root evidence --commit <approved-sha> --run-id <execution-id>`. Verify both actual guest HTTP response files, exact final trace digest, authorization/duplicate denial and deletion observation; bounded initial guest readiness failures remain visible in the trace. Do not use an incomplete trace or report as acceptance evidence.

## Local evaluation API access

The disposable validation runner creates two random test identities, `alpha` and `beta`, in the namespace's `vm-api-test` Secret. It unsets its environment tokens on exit but intentionally retains the dedicated cluster for authorized inspection. It is not a production account registration flow. A separate client should receive only an operator-issued, appropriately scoped credential. Do not read another operator's Secret or grant a client Kubernetes permissions.

On the same authorized dedicated host, the operator may forward only the evaluation HTTP endpoint to loopback:

```sh
kubectl -n vm-interface port-forward --address 127.0.0.1 svc/vm-api 3000:3000
```

In another Bash terminal on that host, the **cluster operator only** can recover the locally generated `alpha` bootstrap test identity directly into a shell variable, without printing it or storing it in a file. Disable tracing and do not use this on a shared host:

```sh
set +x
set -o pipefail
VM_TOKEN=$(kubectl -n vm-interface get secret vm-api-test -o jsonpath='{.data.identities}' | base64 --decode | node -e 'console.log(JSON.parse(require("node:fs").readFileSync(0)).alpha)')
test -n "$VM_TOKEN"
API_URL=http://127.0.0.1:3000/api/v1
curl --fail "$API_URL/health"
curl --fail -H "Authorization: Bearer $VM_TOKEN" "$API_URL/account"
```

Proceed only if token retrieval and the authenticated account check succeed. Use the same terminal for authorized exploration, or create a scoped account key through the documented API for a separate client. Do not echo, log, commit or transfer bootstrap identity values; do not use raw Kubernetes access to substitute for product API tests. See [API walkthrough](api.md#walkthrough-create-and-operate-a-smoke-vm). When finished, `unset VM_TOKEN`, revoke any issued client keys, stop port-forwarding, and dispose of the dedicated device and data when inspection is complete. Never expose this test API to other hosts.
