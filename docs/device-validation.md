# Device validation handoff

This candidate consolidates prepared features. **It is not a certified release.** Do not use on production systems. KVM validation on an eligible device is essential, and image-specific Windows/Android qualification plus consolidated static checks remain necessary.

## 1. Non-virtualization checks

On a machine with network access, Node.js 24 and Python 3.11+:

```sh
git clone https://github.com/rtu0/test_vm.git
cd test_vm
git checkout prep/device-validation
bash scripts/device-validate.sh checks
```

This does not require KVM. It runs typecheck/lint/unit/build, Python syntax/unit checks and shell syntax. The separate static CI workflow also runs these checks; it never uses a hardware runner. Do not interpret its success as guest conformance.

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

### Pinned two-disk Android candidate (not qualified)
The selected upstream candidate is `jqssun/android-lineage-qemu` release `v2026.10.18`, LineageOS 23.2 arm64-only bundle. Release API gives SHA256 `171c0d215899d68f070fd45aea05ddb25737cf4ff16a25468e7cafbc65f4d8c9`, 1121501784 bytes. Obtain the named zip from https://github.com/jqssun/android-lineage-qemu/releases/tag/v2026.10.18, verify publisher attestation with `gh attestation verify <archive> -R jqssun/android-lineage-qemu`, review its licenses, then run `python3 scripts/prepare_android.py <archive> <new-output-dir> --authorized` on an unprivileged host with qemu-img. It checks the pinned archive digest, extracts just vda/vdb and creates disks.json with exact digests and storage capacities. Use vda as `--media`, vdb as `--auxiliary-media`, and corresponding digest/GiB args. UEFI fallback boot, actual VirtioFS mount and SAF access must be verified with this exact image before device acceptance. No bundled NVRAM or unsigned recovery is imported. Do not bypass signatures or SELinux.

Windows native runner now requires `--auxiliary-media /path/to/VMDRIVERS.iso --auxiliary-sha256 <verified-sha256> --auxiliary-gib <capacity>` in addition to the Windows installer. Prepare the separate signed-driver bootstrap media using `showcases/windows/build-driver-iso.py` (see its help). Setup ends at an authorized elevated PowerShell prompt; the runner invokes bootstrap.ps1 from the VMDRIVERS volume, then checks VMDRIVERSREADY. This is not a tested Windows installation.

Prepare the driver ISO with publisher-authorized WinFsp MSI and virtio-win x64 MSI (exact hashes and independently verified signer certificate thumbprints):

```sh
python3 showcases/windows/build-driver-iso.py --authorized --output VMDRIVERS.iso \
  --winfsp winfsp.msi --winfsp-sha256 SHA256 --winfsp-signer THUMBPRINT \
  --virtio virtio-win-gt-x64.msi --virtio-sha256 SHA256 --virtio-signer THUMBPRINT
```

The host only packages files with xorriso; the guest verifies signatures and pinned signer identities before installation. If MSI needs reboot or the selected signed package lacks VirtioFsSvc, fail explicitly and qualify that package normally; no driver or policy bypass. The guest must read an actual random API-uploaded challenge from the mounted drive before VMDRIVERSREADY appears. Local stage-package unit tests use synthetic header bytes only, not genuine packages.
