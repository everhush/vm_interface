#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test "$#" = 2
manifest="$1"; out="$2"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
winfsp="$(python3 scripts/fetch-pinned-media.py winfsp "$work")"
virtio="$(python3 scripts/fetch-pinned-media.py virtio "$work")"
mapfile -t values < <(python3 - "$manifest" <<'PY'
import json,re,sys
from pathlib import Path
sources=json.loads(Path("showcases/media-sources.json").read_text())
report=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
for key in ("winfsp","virtio"):
    records=[x for x in report["packages"] if x["key"]==key]
    if len(records)!=1: raise ValueError("Missing unique driver report")
    r=records[0]
    if r["sha256"] != sources[key]["sha256"] or r["signatureStatus"] != "Valid" or not re.fullmatch("[A-Fa-f0-9]{40}",r["signerThumbprint"]):
        raise ValueError("Driver signature or digest report rejected")
    print(r["sha256"])
    print(r["signerThumbprint"])
PY
)
test "${#values[@]}" = 4
python3 showcases/windows/build-driver-iso.py --winfsp "$winfsp" --winfsp-sha256 "${values[0]}" --winfsp-signer "${values[1]}" --virtio "$virtio" --virtio-sha256 "${values[2]}" --virtio-signer "${values[3]}" --output "$work/drivers.iso" --authorized > "$out/windows-driver-iso.json"
mkdir "$work/extracted"
xorriso -osirrox on -indev "$work/drivers.iso" -extract / "$work/extracted" > "$out/iso-readback.log" 2>&1
cmp "$winfsp" "$work/extracted/winfsp.msi"
cmp "$virtio" "$work/extracted/virtio.msi"
cmp showcases/windows/bootstrap.ps1 "$work/extracted/bootstrap.ps1"
sha256sum "$work/drivers.iso" | cut -d' ' -f1 > "$out/driver-iso.sha256"
# Do not publish third-party MSI/ISO bytes.
