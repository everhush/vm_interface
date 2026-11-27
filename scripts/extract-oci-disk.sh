#!/usr/bin/env bash
# Extract an immutable publisher guest disk. The image is never executed.
set -euo pipefail
test "$#" -eq 2
image="$1"; target="$2"
[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]]
test ! -e "$target"
work="$(mktemp -d)"
b() { sudo buildah --root "$work/store" --runroot "$work/run" --storage-driver overlay "$@"; }
ctr=""
cleanup() {
  if [ -n "$ctr" ]; then b unmount "$ctr" >/dev/null 2>&1 || true; fi
  b rm --all >/dev/null 2>&1 || true
  b rmi --all --force >/dev/null 2>&1 || true
  sudo rm -rf -- "$work"
}
trap cleanup EXIT
ctr="$(b from --pull=always --arch amd64 --os linux "$image")"
root="$(b mount "$ctr")"
sudo test -d "$root/disk"
sudo test ! -L "$root/disk"
mapfile -t files < <(sudo find "$root/disk" -mindepth 1 -maxdepth 1 -type f)
test "${#files[@]}" -eq 1
mkdir -m 700 "$target"
sudo install -m 0600 -o "$(id -u)" -g "$(id -g)" "${files[0]}" "$target/$(basename "${files[0]}")"
