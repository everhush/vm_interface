#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test "$#" = 2
report="$1"; out="$2"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
iso="$(node scripts/fetch-pinned-media.ts virtioISO "$work")"
winfsp="$(node scripts/fetch-pinned-media.ts winfsp "$work")"
node showcases/windows/build-catalog-iso.ts --authorized --iso "$iso" --winfsp "$winfsp" --report "$report" --output "$work/VMDRIVERS.iso" > "$out/driver-iso.json"
