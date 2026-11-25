# Device validation handoff

This candidate consolidates prepared features. **It is not a certified release.** Do not use on production systems. KVM validation on an eligible device is essential, and image-specific Windows/Android qualification plus consolidated static checks remain necessary.

## 1. Non-virtualization checks

On a machine with network access, Node.js 24 and Python 3.11+:

```sh
git clone https://github.com/imxade/vm_interface.git
cd vm_interface
git checkout implementation/virtualization-backend
bash scripts/device-validate.sh checks
```

This does not require KVM. It runs typecheck/lint/unit/build, Python syntax/unit checks and shell syntax. The CI-only fork `xad3play/vm_interface` executes these checks against exact synchronized upstream commits. The separate static CI workflow is reserved for the preparation branch; the implementation branch runs static and KVM checks in one workflow. Upstream job execution is disabled by repository guard. Do not interpret its success as guest conformance.

## 2. Dedicated device

Use a **disposable Linux device**, not an existing cluster, shared persistent self-hosted runner or a personal production PC. Review the checkout before running it. Require a matching x86_64 or AArch64 processor, actual /dev/kvm access, Docker, sudo, Node 24, Python 3.11+, FFmpeg/ffprobe, Tesseract, skopeo and distribution packages used by probes. Core preflight requires >=6 GiB RAM and >=35 GiB free root storage; large media profiles require >=12 GiB and >=100 GiB free. These are conservative starting requirements, not guaranteed sufficient. No software fallback or cloud purchase.

```sh
sudo python3 scripts/device-preflight.py --architecture amd64
bash scripts/device-validate.sh core --confirm-disposable
```

The script provisions K3s and the pinned operator versions, deploys Vinext, generates ephemeral local test account secrets, port-forwards only to localhost, and exercises actual product API tests. It retains the cluster for operator inspection/disposal. Do not rerun over the same installation; use a clean disposable device per validation iteration. It does not register a persistent GitHub runner. KVM API creation alone does not establish actual native acceleration, particularly inside an emulated outer EL2 guest.

## 3. Windows x64

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

Expected Windows output: ASCII "VM Interface Windows 7-Zip functional proof" followed by LF. Expected Android output: UTF-8 "VM Interface Android APK functional proof" followed by LF. The latter must show APKCOMPLETE arm64-v8a. Input markers/after markers are real OCR assertions and must not be inserted into video.

## 6. Evidence

Core proof folders contain platform-recording.mp4, real screenshots, redacted HTTP trace, verification.json and a separately labelled derived presentation. Native showcases produce the same evidence plus output bytes and media/software digests. Preserve original MP4; verify SHA256 and full H264 decode; inspect actual frames and guest results. A static presentation or synthetic video is not evidence. Review failures and rerun after corrections. No release merge until full applicable gates and three comprehensive reviewed passes, unless the owner explicitly changes release policy.

To verify already downloaded evidence independently (no KVM needed): `python3 scripts/verify-evidence.py --root evidence --profile core` or `--profile all` for the four proof folders. This requires original recordings, hashes and reported assertions; it does not certify hardware or replace manual review of actual guest frames. Historical screenshot-only evidence must fail this gate.

### Pinned two-disk Android media (offline qualified; native boot pending)

The LineageOS 23.2 ARM64 bundle from release v2026.10.18 passed publisher-attestation verification, exact archive SHA256 and QCOW2 checks on fork run 45623125031. The signed proof APK was built and checked in the same job. See its android-media-qualification artifact 15026182260 for exact disk manifests and APK digest. This does not certify boot or the exchange mount.

Use an authorized SDK/image and run the acquisition workflow or reproduce its steps using scripts/fetch-pinned-media.py, scripts/qualify-android-media.sh and the pinned sources. Use vda as --media and vdb as --auxiliary-media with the matching hashes and capacities in the disk manifest (6 GiB and 18 GiB respectively). No bundled NVRAM or unsigned recovery is imported. Verify native boot and SAF exchange without bypassing signatures or SELinux.

### Windows driver media (offline qualified; guest installation pending)

The official virtio-win 0.1.302-1 ISO is pinned by exact SHA256. The two tested standalone VirtIO MSI files were unsigned and rejected. Do not use them. The signed Windows Server 2022 INF/SYS catalog, independently signed VirtioFS service, and signed WinFsp MSI were verified in fork run 45624621225. Driver ISO construction and full byte readback passed in run 45625087154, artifact 15028411663. These runs do not certify guest installation.

Run scripts/qualify-windows-catalog.ps1 on Windows against the pinned media. Then, on a Linux host with xorriso, fetch the pinned virtioISO and winfsp using scripts/fetch-pinned-media.py and build the authorized driver ISO:

```sh
python3 showcases/windows/build-catalog-iso.py --authorized --iso /path/to/virtio-win.iso \
  --winfsp /path/to/winfsp.msi --report /path/to/driver-catalog-report.json --output VMDRIVERS.iso
```

Retain the actual output digest, not a digest from a different build (ISO metadata can vary). Add --auxiliary-media /path/to/VMDRIVERS.iso --auxiliary-sha256 <actual-output-sha256> --auxiliary-gib 1 to the Windows command. The image contains bootstrap.ps1, which verifies exact component bytes and signer identities, uses normal signed driver installation and requires the actual API-uploaded challenge before VMDRIVERSREADY. The older MSI packager is retained for historical review only; it is not the qualified input path.

Authorized Windows installation media and exact Windows/Android scenario qualification remain incomplete. Native acceptance is issue #12, which is not started or ready.

### Bundled scenario recipes (prepared, not runtime-qualified)
Use `python3 scripts/write-showcase-scenario.py windows windows-scenario.json` or `python3 scripts/write-showcase-scenario.py android android-scenario.json` to create the concrete client recipe. Windows uses authorized installation and login checkpoints before recording, then actual 7-Zip GUI evidence. Android requires fixture APK version 2.0, adds a post-upload installation and authorized Storage Access Framework directory selection checkpoint, then clicks the exact unique visible Compute proof label using OCR from actual API screenshots. The APK computes and publishes its result/checksum using the user-granted directory. No fabricated click coordinates or recording of credentials. These prepared recipes still require guest qualification on the exact media; missing mount/provider or ambiguous OCR is an explicit failure, not a fallback. The new APK must be rebuilt and independently signature-checked; version 1.0 artifact is historical only.
