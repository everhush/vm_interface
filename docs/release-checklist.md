# Public source and release checklist

The repository is already publicly visible as an evaluation source preview. This checklist distinguishes completed source preparation from remaining maintainer settings, security/distribution review and stable release gates.

## Prepared in the primary source tree

- Project introduction, architecture, safe quickstart, API guide, source map and clear supported/conditional capability table.
- Apache-2.0 LICENSE and NOTICE, contribution and security reporting guidance, third-party licensing boundaries.
- Dated hosted validation record, exact evidence commit/run IDs/checksums, current requirement ledger and preserved original specification/history.
- Locked dependency graph and reproducible checks, with public upstream CI guards in the hosted-qualified migrated candidate; see the [migration record](toolchain-migration.md).
- No tracked guest media, APKs, raw recordings, .env files or private-key filenames in the reviewed primary candidate. No raw artifact ZIP is committed.
- Relative Markdown links in the public documentation checked against the tracked tree; a limited credential-pattern scan of the public documents found no private-key markers, GitHub token patterns, AWS access key patterns or inline database credential URLs. This is not a secret scan of all source or history.
- Documentation index, explicit smoke VM walkthrough and independent acceptance record template prepared. Compare the complete primary tree against the hosted SHA in [validation.md](validation.md) to ensure executable source, tests, dependency lock and infrastructure remain unchanged.

## Publication audit — primary source preview

Current exact hosted qualification: `34652dc2fffd585e8e95aac1a2df63b3552da8f8` (all four hosted gates passed and evidence independently reviewed). See [migration record](toolchain-migration.md). Any source-preview promotion is a fast-forward of qualified executable content and documentation-only successors; keep `main`/`master` aligned. Issue #13 is closed. Do not start independent #12 acceptance as a source-maintenance task or publish a stable release. The prior publication audit below is historical.

The review on 2026-11-27 inspected the previously finalized tree `40ef574c216030b5ff132c6d0443296203ed6af0` against exact hosted qualification `7e095afe6274137104f15caf9cbaef7738d6a9ba`. Both primary refs were identical. The Git tree contained 218 blobs: 196 unchanged, 6 modified and 16 added, with no deletions. All executable sources, dependencies, tests, deployment manifests and workflows matched; only documentation, license, issue/PR templates and `.gitignore` differed. Subsequent quickstart and publication-guidance edits are also non-runtime; recheck the complete tree comparison before any publication.

The upstream had 67 retained branches (62 unique heads), no tags or GitHub releases, and no rulesets returned. Branch metadata reported `main` and `master` unprotected; detailed protection reads were denied by the integration. Default branch remains `master`, aligned with `main`. Do not silently delete preparation branches or rewrite history. Branch inventory is not a scan of every reachable commit.

A targeted content review covered the five CI workflows, `infra/app.yaml`, `infra/namespace.yaml`, `src/db.ts`, `src/auth.ts`, `scripts/device-validate.sh`, `scripts/provision-ci.sh` and `scripts/showcase-native.ts`. No matches for checked private key, GitHub/AWS/Google token, JWT, credential-in-URL or long literal credential patterns were found. This is a limited pattern review, **not a comprehensive secret scan**, dependency vulnerability audit or approval of public visibility. Complete history, issues/PRs, private attachments and artifacts still require an authorized maintainer review. Keep private guest media and credentials outside the source checkout; the OCI builder archives an explicit allowlist of tracked application files.

## Current branch and source audit — 2026-11-28 IST

Reviewed primary baseline `a9542d8abdcc50b67d08d78f2880e542869b6bb2`: 232 tracked blobs; comparison to the exact hosted SHA found only nine documentation paths different, including one addition. No tracked Python source, Dockerfile/.dockerignore, guest binary/recording or private-key filenames matched the checked patterns. The repository is public; no open PRs or GitHub releases were returned. 76 branch refs at 68 distinct heads were compared against primary: 28 non-primary refs have no unique commits, and 46 have unique history. Retain four qualification entry refs and review the 24 remaining ancestor/equal-head refs for pruning. See [repository maintenance](repository-maintenance.md) and [branch inventory](branch-cleanup.tsv) for the exact snapshot and safe leased deletion procedure. No refs or default settings were changed by the audit. The database migration mechanism is consolidated in [src/db.ts](../src/db.ts); production upgrades remain unqualified (see [schema guide](database-schema.md)).

## Continuing public-source review and maintainer settings

- [ ] Maintainer reviews **all** reachable branches/tags and complete git history for credentials, confidential data, third-party source/media and inappropriate personal information; review issue/PR bodies, attachments and Actions logs/artifacts as well. Rotate any exposed credential and remediate before publication. A current-tree filename review is not a full secret scan.
- [ ] Review license/ownership of contributed source and dependency obligations, notices and guest media terms. Do not redistribute external binaries or images without authorization.
- [ ] Set the default branch to `main` in repository settings (keep the legacy `master` aligned until changed). The connected integration cannot change this setting or configure branch protection; do not interpret alignment as a settings update. Configure branch protection, review requirements, security/private vulnerability reporting and Actions permissions; keep qualification restricted to the authorized public upstream and explicit implementation/preparation branches.
- [ ] Confirm public visibility, set repository description/topics and review access permissions in repository settings; avoid publishing private CI artifacts automatically. Source preview status and qualification boundaries must remain visible. Do not imply a public CI badge means main's post-qualification documentation commit ran native tests.

## Maintainer settings and suggested public presentation

The upstream is the source of truth. Keep the legacy default `master` aligned with `main` until the default branch setting can be changed; do not delete history or switch repository visibility as a side effect of documentation work.

Suggested description: **API-first control plane for real, persistent virtual machines on Kubernetes.** Suggested topics: `kubevirt`, `kubernetes`, `kvm`, `virtualization`, `typescript`, `vinext`, `vnc`, `rest-api`. Do not advertise native Android or a stable version before the relevant gates pass. Use the README and [validation record](validation.md) instead of a misleading live CI badge linked to a private fork.

For ongoing public source maintenance, review historical repository/fork visibility implications, issue/PR history, artifacts, commit author metadata, dependency and operator advisories, and secret scanning across all refs. Set least-privilege Actions permissions, branch rules and private vulnerability reporting if available. Keep security contact and support status in [SECURITY.md](../SECURITY.md). These are maintainer settings/review actions, not evidence of completed native acceptance.

## Before stable release or production use

- [ ] Complete [#12](https://github.com/everhush/vm_interface/issues/12): three consecutive comprehensive independent native-device reviews on the approved exact candidate (currently 0/3). Report new defects to implementation owners and repeat as required.
- [ ] Qualify Android native boot and application/file exchange, and only advertise conditional features on tested eligible hardware.
- [ ] Complete distribution-specific SBOM, vulnerability and license/provenance review. Production identity, network exposure, security, operations, backup/recovery and cloud deployment require separate scope and qualification.
- [ ] Review release notes and evidence, approve a version/tag and distribution scope. Do not publish an npm package or container image simply because the source is visible.

The current main tree may be organized and reviewed before #12 without changing the independent acceptance criteria. A source preview is not a stable or production-ready product.
