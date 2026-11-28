#!/usr/bin/env bash
# Dry run by default. Run from an authenticated full clone after reviewing the inventory.
set -euo pipefail
mode="${1:---dry-run}"
[[ "$mode" == --dry-run || "$mode" == --apply ]] || { echo "Usage: bash docs/branch-prune.sh [--dry-run|--apply]"; exit 2; }
cd "$(git rev-parse --show-toplevel)"
remote="$(git remote get-url origin)"
case "$remote" in
  https://github.com/everhush/vm_interface.git|https://github.com/everhush/vm_interface|git@github.com:everhush/vm_interface.git|ssh://git@github.com/everhush/vm_interface.git) ;;
  *) echo "Unexpected origin"; exit 1 ;;
esac
git fetch origin --prune --tags
[[ "$(git rev-parse --is-shallow-repository)" == false ]] || { echo "Full clone required"; exit 1; }
[[ "$(git rev-parse refs/remotes/origin/main)" == "$(git rev-parse refs/remotes/origin/master)" ]] || { echo "Primary refs diverged"; exit 1; }
archive='6d4aede927e8060a0a2f7a124263f04efdcb9d6a'
archive_ref='refs/heads/archive/pre-consolidation-20261128'
[[ "$(git rev-parse refs/remotes/origin/archive/pre-consolidation-20261128)" == "$archive" ]] || { echo "Archive ref moved"; exit 1; }
# Verify every original secondary head BEFORE any mutation.
declare -a refs=() shas=()
while IFS=$'\t' read -r branch sha decision ancestry; do
  case "$decision" in prune-candidate|qualification|archive-review) ;; *) continue ;; esac
  [[ "$branch" != main && "$branch" != master ]] || exit 1
  git check-ref-format "refs/heads/$branch" >/dev/null
  actual="$(git ls-remote --heads origin "refs/heads/$branch" | cut -f1)"
  [[ "$actual" == "$sha" ]] || { echo "Missing or changed ref: $branch"; exit 1; }
  if [[ "$decision" == archive-review ]]; then
    git merge-base --is-ancestor "$sha" "$archive"
  else
    git merge-base --is-ancestor "$sha" refs/remotes/origin/main
  fi
  refs+=("refs/heads/$branch"); shas+=("$sha")
  printf 'Eligible: %s %s\n' "$branch" "$sha"
done < docs/branch-cleanup.tsv
[[ "${#refs[@]}" == 74 ]] || { echo "Expected 74 reviewed secondary refs"; exit 1; }
expected_refs="$(printf '%s\n' refs/heads/main refs/heads/master "$archive_ref" "${refs[@]}" | LC_ALL=C sort)"
actual_refs="$(git ls-remote --heads origin | cut -f2 | LC_ALL=C sort)"
[[ "$actual_refs" == "$expected_refs" ]] || { echo "Remote branch inventory changed"; exit 1; }
[[ "$mode" == --apply ]] || { echo "Dry run only. No refs deleted."; exit 0; }
command -v gh >/dev/null || { echo "Authenticated GitHub CLI required"; exit 1; }
[[ "$(gh api repos/everhush/vm_interface --jq .default_branch)" == main ]] || { echo "Set main as default first"; exit 1; }
[[ "$(gh pr list --repo everhush/vm_interface --state open --limit 100 --json number --jq length)" == 0 ]] || { echo "Open PRs exist"; exit 1; }
for status in queued in_progress waiting requested pending; do
  [[ "$(gh run list --repo everhush/vm_interface --status "$status" --limit 1 --json databaseId --jq length)" == 0 ]] || { echo "Active workflow: $status"; exit 1; }
done
# Bundle all refs and verify all reviewed commits can be restored in an independent clone.
umask 077
backup="$(mktemp -d "$HOME/vm-interface-before-prune.XXXXXXXX")"
git bundle create "$backup/repository.bundle" --all
git bundle verify "$backup/repository.bundle"
git clone --mirror "$backup/repository.bundle" "$backup/restore.git"
for sha in "${shas[@]}" "$archive"; do
  git -C "$backup/restore.git" cat-file -e "$sha^{commit}"
done
git -C "$backup/restore.git" fsck --connectivity-only
printf 'Verified private backup: %s\n' "$backup/repository.bundle"
# Keep the archive reachable as a tag, so only main and master need remain as branches.
tag='archive-pre-consolidation-20261128'
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  [[ "$(git ls-remote --tags origin "refs/tags/$tag" | cut -f1)" == "$archive" ]] || { echo "Archive tag conflict"; exit 1; }
else
  git push origin "$archive:refs/tags/$tag"
fi
[[ "$(git ls-remote --tags origin "refs/tags/$tag" | cut -f1)" == "$archive" ]] || exit 1
# Atomic, exact-head leased deletions. No primary refs are modified.
declare -a leases=() deletes=()
for i in "${!refs[@]}"; do
  leases+=("--force-with-lease=${refs[i]}:${shas[i]}")
  deletes+=(":${refs[i]}")
done
leases+=("--force-with-lease=$archive_ref:$archive")
deletes+=(":$archive_ref")
git push --atomic "${leases[@]}" origin "${deletes[@]}"
git fetch origin --prune
remaining="$(git ls-remote --heads origin | cut -f2 | LC_ALL=C sort)"
[[ "$remaining" == "$(printf '%s\n' refs/heads/main refs/heads/master)" ]] || { echo "Unexpected remaining branch inventory; inspect manually"; exit 1; }
git ls-remote --heads origin
echo "Pruning completed. Retain the private backup."
