# Security policy

## Supported status

VM Interface is an evaluation preview, not a production-hardened service. No stable release or production support commitment exists. The current test-only authentication, local disposable K3s deployment and conditional guest profiles must not be exposed to untrusted users or the public internet. Use clean, dedicated hardware, scoped test identities, least-privilege policies, certificate-verified WSS and explicit recording/guest interaction consent.

## Reporting a vulnerability

Please contact the maintainer privately at **ycantistudy@gmail.com** with a short description, affected commit, impact, minimal reproduction and redacted supporting evidence. Do not open a public issue containing credentials, exploitable configuration, guest personal data or sensitive vulnerability details. Do not test other users' systems or accounts without authorization. Coordinate disclosure with the maintainer; there is no guaranteed response or remediation SLA.

For ordinary non-sensitive bugs use the GitHub issue tracker. Include architecture, guest/media profile, exact commit and test result. Do not attach secret-bearing logs, tokens, account keys, private console/network tickets, guest images or recordings unless specifically authorized and sanitized.

## Operator expectations

Keep test clusters and API access private; use normal guest authentication and licensing. Do not disable TLS verification, SELinux, guest signatures or isolation checks to force a pass. Treat VM disks and exported data as sensitive. Use a disposable device and dispose of retained clusters and guest data after inspection. Separate integrity pins from publisher provenance and licensing review. Follow the [release checklist](docs/release-checklist.md) before any wider distribution.
