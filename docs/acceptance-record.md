# Independent device acceptance — review record template

Use this template for each comprehensive iteration of [issue #12](https://github.com/everhush/vm_interface/issues/12). This is a record, not a new test specification or a passing result. The migrated qualification candidate is `34652dc2fffd585e8e95aac1a2df63b3552da8f8`; it is not yet approved. Record only the exact source explicitly approved in #12 after all required hosted gates and evidence review; follow the [device guide](device-validation.md) and issue for exact execution and scope.

Keep the filled record and original evidence private until reviewed for credentials, guest data and licensing. Retain failed iterations as well as successful ones. Do not execute source changes under this validation-only issue.

## Iteration identity

| Field | Record |
| --- | --- |
| Iteration ID and UTC date | |
| Approved source SHA (same for every included execution) | |
| Reviewer / operator authorization | |
| x86_64 core host, OS, KVM preflight result and run ID | |
| Separate Linux showcase host, preflight result and run ID | |
| AArch64 host, OS, KVM preflight result and run ID | |
| Android media manifest and APK SHA-256, transfer path selected | |
| Conditional hardware / storage profiles attempted or ineligible, with reason | |

## Evidence and review

- [ ] Core execution on a clean authorized x86_64 KVM device; static tests, native stages, recovery, input ownership, media, network, disk and exchange results.
- [ ] Independent Linux showcase: actual installation/execution, challenge/result and archive bytes, pointer receipt, persistent disks, cold resize and original recording.
- [ ] Native ARM64 Android: actual guest boot/display, authorized APK installation and execution, verified input/output transfer, cold resize/persistence and original recording.
- [ ] Eligible conditional checks as required by the issue; explicitly record unsupported/not-attempted profiles rather than counting them as passes.
- [ ] Original MP4s, decoded visible markers, redacted API traces, screenshots, preflight and machine state, exact file/disk digests, run provenance and verifier JSON retained.
- [ ] Same-source aggregate review with `node scripts/verify-evidence.ts --profile all --root <private-reviewed-evidence-root> --commit <approved-sha>`; core proof directories from the same execution; separate Linux and Android evidence provenance retained.
- [ ] Review actual guest results and original video manually as well as automated verification. Record teardown/disposal; verify no guest resources or credentials are inadvertently left accessible.

| Evidence set | Private archive location / ID | SHA-256 | Review verdict |
| --- | --- | --- | --- |
| Core | | | |
| Linux showcase | | | |
| Android showcase | | | |
| Conditional checks | | | |

## Verdict

Record **PASS**, **FAIL**, or **INCOMPLETE**, with exact failed stage/command, observed error and sanitized evidence links. An incomplete or failed required gate is not a comprehensive pass. Route implementation defects to the appropriate #1–#9 issue; no patches or skipped assertions under #12. Record the consecutive comprehensive reviewed-pass count (0–3); reset after any failed required validation or implementation change. Hosted qualification is not an independent pass. Stable release remains gated until all applicable requirements and three consecutive comprehensive reviews are satisfied.
