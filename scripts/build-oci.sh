#!/usr/bin/env bash
# Build a single-architecture OCI image without a daemon or an existing image store.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"
case "$mode" in
  k3s) test "$#" -eq 1; sudo k3s ctr version >/dev/null ;;
  archive) test "$#" -eq 2; output="$(realpath -m "$2")"; test ! -e "$output"; test -d "$(dirname "$output")" ;;
  *) echo 'Usage: bash scripts/build-oci.sh k3s | archive /absolute/output.tar' >&2; exit 2 ;;
esac
test -z "$(git status --porcelain --untracked-files=no)"
command -v buildah >/dev/null
work="$(mktemp -d)"
b() { sudo buildah --root "$work/store" --runroot "$work/run" --storage-driver overlay "$@"; }
cleanup() {
  b rm --all >/dev/null 2>&1 || true
  b rmi --all --force >/dev/null 2>&1 || true
  sudo rm -rf -- "$work"
}
trap cleanup EXIT
mkdir "$work/context"
# Only tracked application sources and locked dependencies enter the image.
git archive HEAD app src package.json package-lock.json tsconfig.json next.config.ts LICENSE NOTICE | tar -x -C "$work/context"
base="${VM_OCI_BASE_IMAGE:-docker.io/library/node:24-bookworm-slim}"
ctr="$(b from --pull=always "$base")"
b run --isolation chroot "$ctr" -- sh -ec 'apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*'
b config --workingdir /app "$ctr"
b copy "$ctr" "$work/context/package.json" "$work/context/package-lock.json" /app/
b run --isolation chroot "$ctr" -- npm ci --no-audit --no-fund
b copy "$ctr" "$work/context/" /app/
b run --isolation chroot "$ctr" -- npm run build
b config --env NODE_ENV=production --env HOST=0.0.0.0 --env PORT=3000 --user 1000 --port 3000 --entrypoint '[]' --cmd '["npm","run","start","--","--hostname","0.0.0.0","--port","3000"]' "$ctr"
b commit --format oci "$ctr" localhost/vm-interface:ci
b push --format oci localhost/vm-interface:ci "oci-archive:$work/image.tar:ci"
# Check the archive is an actual OCI image layout before importing or publishing.
sudo tar -tf "$work/image.tar" | grep -Fx 'oci-layout'
sudo tar -tf "$work/image.tar" | grep -Fx 'index.json'
if [ "$mode" = k3s ]; then
  sudo k3s ctr -n k8s.io images import --base-name localhost/vm-interface "$work/image.tar"
  sudo k3s ctr -n k8s.io images list -q | grep -Fx 'localhost/vm-interface:ci'
else
  sudo install -m 0644 -o "$(id -u)" -g "$(id -g)" "$work/image.tar" "$output"
  sha256sum "$output"
fi
