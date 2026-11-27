# Public source and release checklist

This is the preparation checklist for an evaluation source preview. It does not authorize a change in repository visibility or a stable release.

## Prepared in the primary source tree

- Project introduction, architecture, safe quickstart, API guide, source map and clear supported/conditional capability table.
- Apache-2.0 LICENSE and NOTICE, contribution and security reporting guidance, third-party licensing boundaries.
- Dated hosted validation record, exact evidence commit/run IDs/checksums, current requirement ledger and preserved original specification/history.
- Locked dependency graph and reproducible checks, existing CI-only fork guard unchanged.
- No tracked guest media, APKs, raw recordings, .env files or private-key filenames in the reviewed primary candidate. No raw artifact ZIP is committed.

## Before making a private repository public

- [ ] Maintainer explicitly approves source visibility and reviews **all** reachable branches/tags and complete git history for credentials, confidential data, third-party source/media and inappropriate personal information; review issue/PR bodies, attachments and Actions logs/artifacts as well. Rotate any exposed credential and remediate before publication. A current-tree filename review is not a full secret scan.
- [ ] Review license/ownership of contributed source and dependency obligations, notices and guest media terms. Do not redistribute external binaries or images without authorization.
- [ ] Set the default branch to the intended main branch (if the host has a legacy master default, keep it aligned until changed). Configure branch protection, review requirements, security/private vulnerability reporting and Actions permissions; keep the CI-only fork separation.
- [ ] Choose visibility, repository description/topics and access permissions in repository settings; avoid publishing private CI artifacts automatically. Source preview status and qualification boundaries must remain visible. Do not imply a public CI badge means main's post-qualification documentation commit ran native tests.

## Before stable release or production use

- [ ] Complete [#12](https://github.com/imxade/vm_interface/issues/12): three consecutive comprehensive independent native-device reviews on the approved exact candidate (currently 0/3). Report new defects to implementation owners and repeat as required.
- [ ] Qualify Android native boot and application/file exchange, and only advertise conditional features on tested eligible hardware.
- [ ] Complete distribution-specific SBOM, vulnerability and license/provenance review. Production identity, network exposure, security, operations, backup/recovery and cloud deployment require separate scope and qualification.
- [ ] Review release notes and evidence, approve a version/tag and distribution scope. Do not publish an npm package or container image simply because the source is visible.

The current main tree may be organized and reviewed before #12 without changing the independent acceptance criteria. A source preview is not a stable or production-ready product.
