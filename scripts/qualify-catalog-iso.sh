#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test "$#" = 2
report="$1"; out="$2"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
iso="$(python3 scripts/fetch-pinned-media.py virtioISO "$work")"
winfsp="$(python3 scripts/fetch-pinned-media.py winfsp "$work")"
python3 showcases/windows/build-catalog-iso.py --authorized --iso "$iso" --winfsp "$winfsp" --report "$report" --output "$work/VMDRIVERS.iso" > "$out/driver-iso.json"
