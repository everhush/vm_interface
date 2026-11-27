# Public source and release checklist

This is the preparation checklist for an evaluation source preview. It does not authorize a change in repository visibility or a stable release.

## Prepared in the primary source tree

- Project introduction, architecture, safe quickstart, API guide, source map and clear supported/conditional capability table.
- Apache-2.0 LICENSE and NOTICE, contribution and security reporting guidance, third-party licensing boundaries.
- Dated hosted validation record, exact evidence commit/run IDs/checksums, current requirement ledger and preserved original specification/history.
- Locked dependency graph and reproducible checks, existing CI-only fork guard unchanged.
- No tracked guest media, APKs, raw recordings, .env files or private-key filenames in the reviewed primary candidate. No raw artifact ZIP is committed.
- Relative Markdown links in the public documentation checked against the tracked tree; a limited credential-pattern scan of the public documents found no private-key markers, GitHub token patterns, AWS access key patterns or inline database credential URLs. This is not a secret scan of all source or history.
- Documentation index, explicit smoke VM walkthrough and independent acceptance record template prepared. Compare the complete primary tree against the hosted SHA in [validation.md](validation.md) to ensure executable source, tests, dependency lock and infrastructure remain unchanged.

## Before making a private repository public

- [ ] Maintainer explicitly approves source visibility and reviews **all** reachable branches/tags and complete git history for credentials, confidential data, third-party source/media and inappropriate personal information; review issue/PR bodies, attachments and Actions logs/artifacts as well. Rotate any exposed credential and remediate before publication. A current-tree filename review is not a full secret scan.
- [ ] Review license/ownership of contributed source and dependency obligations, notices and guest media terms. Do not redistribute external binaries or images without authorization.
- [ ] Set the default branch to the intended main branch (if the host has a legacy master default, keep it aligned until changed). Configure branch protection, review requirements, security/private vulnerability reporting and Actions permissions; keep the CI-only fork separation.
- [ ] Choose visibility, repository description/topics and access permissions in repository settings; avoid publishing private CI artifacts automatically. Source preview status and qualification boundaries must remain visible. Do not imply a public CI badge means main's post-qualification documentation commit ran native tests.

## Maintainer settings and suggested public presentation

The upstream is the source of truth. Keep the legacy default `master` aligned with `main` until the default branch setting can be changed; do not delete history or switch repository visibility as a side effect of documentation work.

Suggested description: **API-first control plane for real, persistent virtual machines on Kubernetes.** Suggested topics: `kubevirt`, `kubernetes`, `kvm`, `virtualization`, `typescript`, `vinext`, `vnc`, `rest-api`. Do not advertise native Android or a stable version before the relevant gates pass. Use the README and [validation record](validation.md) instead of a misleading live CI badge linked to a private fork.

Before enabling public access, review private repository/fork visibility implications, issue/PR history, artifacts, commit author metadata, dependency and operator advisories, and secret scanning across all refs. Set least-privilege Actions permissions, branch rules and private vulnerability reporting if available. Keep security contact and support status in [SECURITY.md](../SECURITY.md). These are maintainer settings/review actions, not evidence of completed native acceptance.

## Before stable release or production use

- [ ] Complete [#12](https://github.com/imxade/vm_interface/issues/12): three consecutive comprehensive independent native-device reviews on the approved exact candidate (currently 0/3). Report new defects to implementation owners and repeat as required.
- [ ] Qualify Android native boot and application/file exchange, and only advertise conditional features on tested eligible hardware.
- [ ] Complete distribution-specific SBOM, vulnerability and license/provenance review. Production identity, network exposure, security, operations, backup/recovery and cloud deployment require separate scope and qualification.
- [ ] Review release notes and evidence, approve a version/tag and distribution scope. Do not publish an npm package or container image simply because the source is visible.

The current main tree may be organized and reviewed before #12 without changing the independent acceptance criteria. A source preview is not a stable or production-ready product.
