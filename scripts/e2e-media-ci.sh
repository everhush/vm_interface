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

# Official public URL plus exact publisher SHA256SUMS and release asset length.
url=https://download.cirros-cloud.net/0.6.3/cirros-0.6.3-x86_64-disk.img
pin=7d6355852aeb6dbcd191bcda7cd74f1536cfe5cbf8a10495a7283a8396e4b75b
python3 scripts/acquire-image.py "$url" "$work/public.img" --sha256 "$pin" --allow-host download.cirros-cloud.net --allow-host github.com --allow-host release-assets.githubusercontent.com --expected-bytes 21692416 --max-bytes 21692416 --public-cache "$work/cache" --authorized | tee evidence/public-image-acquisition.json
python3 scripts/acquire-image.py "$url" "$work/public-copy.img" --sha256 "$pin" --allow-host download.cirros-cloud.net --allow-host github.com --allow-host release-assets.githubusercontent.com --expected-bytes 21692416 --max-bytes 21692416 --public-cache "$work/cache" --authorized | tee evidence/public-image-cache.json
cmp "$work/public.img" "$work/public-copy.img"
python3 -c 'import json; assert not json.load(open("evidence/public-image-acquisition.json"))["cacheHit"]; assert json.load(open("evidence/public-image-cache.json"))["cacheHit"]'
python3 scripts/e2e-media.py "$work/public-copy.img" url
