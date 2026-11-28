# Repository maintenance and public source preview

## Source of truth

The public upstream is [everhush/vm_interface](https://github.com/everhush/vm_interface). `main` is the sole primary source for development and documentation. GitHub's configured default remains `master` until an administrator selects `main`; retire `master` after verifying ancestry and switching the default. Retain `nextjs` for framework compatibility and `prototype-submission` for MVP submissions as separate work branches, not additional primary branches. This is a hosted-qualified evaluation source preview, not a stable release. Issue [#13](https://github.com/everhush/vm_interface/issues/13) is closed; [#12](https://github.com/everhush/vm_interface/issues/12) remains validation-only, unstarted (0/3 independent passes); comprehensive readiness requires Windows showcase qualification (#33).

The exact executable qualification is [`34652dc2fffd585e8e95aac1a2df63b3552da8f8`](https://github.com/everhush/vm_interface/commit/34652dc2fffd585e8e95aac1a2df63b3552da8f8). The reviewed primary baseline for this cleanup is [`a9542d8abdcc50b67d08d78f2880e542869b6bb2`](https://github.com/everhush/vm_interface/commit/a9542d8abdcc50b67d08d78f2880e542869b6bb2). A complete tree comparison found 231 qualified and 232 primary tracked blobs; all differences were documentation. The [migration record](toolchain-migration.md) preserves all 65 Python-file mappings and the Vite+/Kubernetes evidence. Do not cherry-pick old Python, daemon-build, or superseded CI branches over the qualified source. Database initialization and compatibility upgrades are already consolidated in [src/db.ts](../src/db.ts); see [schema and upgrade boundaries](database-schema.md).

## Branch inventory — snapshot, not an execution receipt

Pre-consolidation snapshot: 76 branches at 68 distinct heads, no open pull requests, and all four recorded hosted runs terminal success on the exact source. See [branch-cleanup.tsv](branch-cleanup.tsv) for every observed name and full SHA. GitHub comparisons against the reviewed primary showed 28 non-primary branches contained in main (zero ahead), and 46 divergent branches with unique commits.

| Decision | Branches | Action |
| --- | ---: | --- |
| primary (historical snapshot) | 2 | Retain main; retire master after switching default and verifying ancestry |
| qualification | 4 | Prune after CI routing consolidation; all at the qualified SHA already contained in main |
| prune-candidate | 24 | Ancestor/equal to primary, no unique commits; safe candidates after checking current heads and open PRs |
| archive-review | 46 | Preserved by the archival commit below; keep until backup is verified |

## CI routing and archival preservation

All 46 divergent branch heads were re-compared against the pre-consolidation primary `32b5df69f6bdf7e546cd8063d0c8e33ac8a2e1dc`. Forty-three were imported historical snapshots and three were intermediate Vite+ migration branches. The comparisons identified legacy Python/Docker tooling, retired workflows, diagnostics, and superseded implementations; byte-for-byte patch equivalence is not asserted. No old code was merged into main.

The dedicated archive reference `archive/pre-consolidation-20261128` points to [`6d4aede927e8060a0a2f7a124263f04efdcb9d6a`](https://github.com/everhush/vm_interface/commit/6d4aede927e8060a0a2f7a124263f04efdcb9d6a), whose 47 direct parents are the pre-consolidation primary and all 46 divergent heads. Its tree is identical to that primary tree. This preserves every unique commit and tree through a reachable ref without integrating obsolete code. The 28 other non-primary heads are already ancestors of main. The archive is a preservation reference, not a product branch or new test result. Keep it until a verified private bundle or archival tag exists.

CI runs are independent of preparation branch names:

- Native core and its static prerequisite run on runtime/test/dependency changes pushed to main; also manually dispatchable.
- Static checks run on pull requests targeting main, workflow-file changes pushed to main, and manual dispatch; concurrency is per event and ref.
- Android input and CSI qualification run by explicit manual dispatch.
- Media qualification runs by explicit manual dispatch with a lane selector for all, Windows media, Android media, or showcase scenarios. Preparation does not certify actual guest execution.

Historical runs retain their original commit and branch provenance. The qualified executable SHA is still `34652dc2fffd585e8e95aac1a2df63b3552da8f8`; changed routing is not a new same-SHA qualification result. See [migration evidence](toolchain-migration.md).

## Maintainer cleanup procedure

The source maintenance connection cannot change the default branch, delete refs, create tags or configure rulesets. The account has administrator access; these operations require an authenticated owner terminal or repository UI. **No original branch deletion or default-branch settings change has been performed by this review.** A repository administrator must complete these actions. Use an authenticated local terminal or GitHub Settings. Do not enter tokens into issue bodies, shell history or this repository.

1. Verify the repository URL, current main/master, open pull requests and active Actions runs. Set the default branch to `main` at [repository settings](https://github.com/everhush/vm_interface/settings) (or `gh repo edit everhush/vm_interface --default-branch main` with an already-authenticated owner CLI). Retire master only after the default is changed, ancestry verified and external references reviewed. Retain nextjs and prototype-submission. Configure appropriate branch protection/review requirements, private vulnerability reporting, least-privilege Actions permissions, and the description/topics in the [release checklist](release-checklist.md).
2. From a fresh **full** clone, create and verify a private backup bundle before deleting any branch. Keep the backup outside the repository; it can contain historical material and must not be published.

```sh
git clone https://github.com/everhush/vm_interface.git vm-interface-maintenance
cd vm-interface-maintenance
git fetch origin --prune --tags
git switch main
git pull --ff-only origin main
git bundle create ../vm-interface-before-prune.bundle --all
git bundle verify ../vm-interface-before-prune.bundle
```

3. Review the `prune-candidate` and `qualification` rows in the snapshot. The following is a **read-only dry run**, requiring Bash. It refuses moved refs and non-ancestors. Verify there are still no open PRs or active workflows using the selected refs. Missing/moved/protected branches require a fresh audit.

```bash
set -euo pipefail
git fetch origin --prune
while IFS=$'\t' read -r branch sha decision ancestry; do
  [[ "$decision" == prune-candidate || "$decision" == qualification ]] || continue
  ref="refs/heads/$branch"
  remote=$(git ls-remote --heads origin "$ref" | cut -f1)
  [[ "$remote" == "$sha" ]] || { printf 'SKIP changed/missing: %s\n' "$branch"; continue; }
  git merge-base --is-ancestor "$sha" refs/remotes/origin/main || {
    printf 'SKIP unique history: %s\n' "$branch"; continue;
  }
  printf 'Eligible (not deleted): %s %s\n' "$branch" "$sha"
done < docs/branch-cleanup.tsv
```

4. For each approved candidate, delete with an exact lease after those checks. The lease guards against a concurrent branch update. Do **not** use a wildcard deletion or a force update of main/master. Substitute the approved branch and full observed SHA, not placeholders literally.

```bash
branch='approved-branch-name'
sha='full-reviewed-branch-sha'
ref="refs/heads/$branch"
[[ "$branch" != main && "$branch" != master ]] || exit 1
git merge-base --is-ancestor "$sha" refs/remotes/origin/main &&
  git push --force-with-lease="$ref:$sha" origin ":$ref"
```

5. For divergent rows, verify each exact SHA is reachable from the archival commit and included in the private bundle. Review any remaining unique patch before integrating it; no wholesale merges. The archive ref can be converted into the archival tag `archive-pre-consolidation-20261128` only after an independently verified complete private bundle is safely retained. Recheck current refs, active workflows and open pull requests before leased deletion. The desired final branch list is `main`, `nextjs`, and `prototype-submission` (only `main` is primary). The cleanup script also retires `master` and preserves both work branches. No deletion is recorded here. See [branch cleanup script](branch-prune.sh) for a guarded dry run and explicit apply mode. From an authenticated full clone of current main, use `bash docs/branch-prune.sh --dry-run`. After setting the default to main and reviewing the dry run, use `bash docs/branch-prune.sh --apply`. It validates the full branch inventory, verifies a private backup by restoring it, creates the archive tag, and attempts atomic exact-head leased deletions; it refuses unexpected refs, open PRs, active workflows or changed branch heads. Do not publish the private backup.

## Public source and release boundary

Public visibility is already enabled. A source preview may be used for evaluation; no stable version, tag, binary publication, package publishing, or native Android claim is authorized by this audit. Current-tree filename and documentation checks do not constitute a full history secret scan, vulnerability scan, or third-party licensing audit. Review the complete history, branches, issues, PRs and retained artifacts and remediate credentials or licensing concerns separately. For a stable release, the independent acceptance and distribution checks in the [release checklist](release-checklist.md) still apply.
