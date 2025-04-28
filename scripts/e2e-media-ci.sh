#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
work=$(mktemp -d)
container=""
trap 'if [ -n "$container" ]; then docker rm "$container" >/dev/null 2>&1 || true; fi; rm -rf "$work"' EXIT
image='quay.io/kubevirt/cirros-container-disk-demo@sha256:0e5ac38b20abcc7752293425b239a147868facd62cd5030dede6da6f2fc526a1'
docker pull --platform linux/amd64 "$image"
# Extract immutable publisher disk bytes; never execute the image.
container=$(docker create --entrypoint /bin/false "$image")
mkdir -p "$work/disk"
docker cp "$container:/disk/." "$work/disk/"
mapfile -t disks < <(find "$work/disk" -maxdepth 1 -type f)
test "${#disks[@]}" -eq 1
python3 scripts/e2e-media.py "${disks[0]}" direct
python3 scripts/e2e-media.py "${disks[0]}" resumable
python3 scripts/e2e-media.py "${disks[0]}" dual
