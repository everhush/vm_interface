# Repository maintenance and public source preview

## Source of truth

The public upstream is [everhush/vm_interface](https://github.com/everhush/vm_interface). `main` is the primary source for development and documentation. At the 2026-11-28 IST review, GitHub's configured default is still `master`; keep it aligned until a repository administrator selects `main`. This is a hosted-qualified evaluation source preview, not a stable release. Issue [#13](https://github.com/everhush/vm_interface/issues/13) is closed; [#12](https://github.com/everhush/vm_interface/issues/12) remains validation-only, unstarted (0/3 independent passes).

The exact executable qualification is [`34652dc2fffd585e8e95aac1a2df63b3552da8f8`](https://github.com/everhush/vm_interface/commit/34652dc2fffd585e8e95aac1a2df63b3552da8f8). The reviewed primary baseline for this cleanup is [`a9542d8abdcc50b67d08d78f2880e542869b6bb2`](https://github.com/everhush/vm_interface/commit/a9542d8abdcc50b67d08d78f2880e542869b6bb2). A complete tree comparison found 231 qualified and 232 primary tracked blobs; all differences were documentation. The [migration record](toolchain-migration.md) preserves all 65 Python-file mappings and the Vite+/Kubernetes evidence. Do not cherry-pick old Python, daemon-build, or superseded CI branches over the qualified source. Database initialization and compatibility upgrades are already consolidated in [src/db.ts](../src/db.ts); see [schema and upgrade boundaries](database-schema.md).

## Branch inventory — snapshot, not an execution receipt

At review: 76 branches at 68 distinct heads, no open pull requests, no GitHub releases, and all four required hosted runs terminal success on the exact source. See [branch-cleanup.tsv](branch-cleanup.tsv) for every observed name and full SHA. GitHub comparisons against the reviewed primary showed 28 non-primary branches contained in main (zero ahead), and 46 divergent branches with unique commits.

| Decision | Branches | Action |
| --- | ---: | --- |
| primary | 2 | Retain main and current default master; change default through Settings first |
| qualification | 4 | Retain exact core, static, Android and CSI entry refs for reproducibility; all at the qualified SHA |
| prune-candidate | 24 | Ancestor/equal to primary, no unique commits; safe candidates after checking current heads and open PRs |
| archive-review | 46 | Preserve; unique history requires archive and patch review before pruning |

The four qualification refs are `implementation/issue13-exact-final`, `prep/kubernetes-typescript`, `prep/android-prepared-ci` and `prep/storage-growth-ci`. The existing workflows are branch-targeted and manually dispatchable; do not create duplicate push runs just to refresh documentation or clean refs. Old preparation aliases can be removed after current-head checks; a commit SHA, not a branch name, defines historical evidence. Review any old branch links in issues/PRs when removing refs.

The three divergent Vite+ preparation heads (`d7430de`, `648fe8e`, `b5ec916`) contain superseded variants of the migration guard, evidence tests, exchange code and CI preparation workflow. Their final-source equivalents are present or the temporary preparation workflow was retired. Byte-for-byte equality is not asserted; use patch review, not a wholesale merge. Older divergent preparation/probe heads are historical experiments, not automatically approved product code. Do not discard their unique commits just to obtain a short branch list.

## Maintainer cleanup procedure

The source maintenance connection cannot change the default branch, delete refs, create tags or configure rulesets. **No branch deletion or settings change has been performed by this review.** A repository administrator must complete these actions. Use an authenticated local terminal or GitHub Settings. Do not enter tokens into issue bodies, shell history or this repository.

1. Verify the repository URL, current main/master, open pull requests and active Actions runs. Set the default branch to `main` at [repository settings](https://github.com/everhush/vm_interface/settings) (or `gh repo edit everhush/vm_interface --default-branch main` with an already-authenticated owner CLI). Keep master until the default is changed and external references are reviewed. Configure appropriate branch protection/review requirements, private vulnerability reporting, least-privilege Actions permissions, and the description/topics in the [release checklist](release-checklist.md).
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

3. Review the `prune-candidate` rows in the snapshot. The following is a **read-only dry run**, requiring Bash. It refuses moved refs and non-ancestors. Verify there are still no open PRs or active workflows using the selected refs. Missing/moved/protected branches require a fresh audit.

```bash
set -euo pipefail
git fetch origin --prune
while IFS=$'\t' read -r branch sha decision ancestry; do
  [[ "$decision" == prune-candidate ]] || continue
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

5. For the divergent rows, first inspect `git log origin/main..origin/<branch>` and `git diff origin/main...origin/<branch>`. Keep any useful changes separate, validate them as a new candidate if they affect executable content, and archive superseded experiments in a verified private bundle or a reviewed historical ref before approving deletion. The current snapshot is not proof of patch equivalence. Never merge obsolete trees into main merely to mark a branch merged. Recheck the primary tree and branch inventory after cleanup.

## Public source and release boundary

Public visibility is already enabled. A source preview may be used for evaluation; no stable version, tag, binary publication, package publishing, or native Android claim is authorized by this audit. Current-tree filename and documentation checks do not constitute a full history secret scan, vulnerability scan, or third-party licensing audit. Review the complete history, branches, issues, PRs and retained artifacts and remediate credentials or licensing concerns separately. For a stable release, the independent acceptance and distribution checks in the [release checklist](release-checklist.md) still apply.
