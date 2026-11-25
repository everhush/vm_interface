#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test "$#" = 1
out="$1"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="$(python3 scripts/fetch-pinned-media.py android "$work")"
gh attestation verify "$archive" --repo jqssun/android-lineage-qemu --format json > "$out/android-attestation.json"
python3 scripts/prepare_android.py "$archive" "$work/disks" --authorized > "$out/android-disk-manifest.json"
test -f "$ANDROID_HOME/platforms/android-34/android.jar"
test -x "$ANDROID_HOME/build-tools/34.0.0/apksigner"
bash showcases/android/build-apk.sh "$out/proof.apk" > "$out/apk-build.txt"
"$ANDROID_HOME/build-tools/34.0.0/apksigner" verify --verbose --print-certs "$out/proof.apk" > "$out/apk-signature.txt"
"$ANDROID_HOME/build-tools/34.0.0/aapt2" dump badging "$out/proof.apk" > "$out/apk-badging.txt"
grep -F "package: name='org.vminterface.proof'" "$out/apk-badging.txt"
(cd "$out"; sha256sum proof.apk > apk.sha256)
# Retain only metadata and our fixture APK, not third-party disk images.
