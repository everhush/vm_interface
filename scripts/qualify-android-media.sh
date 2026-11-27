#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test "$#" = 1 || { test "$#" = 2 && test "$2" = --retain-disks; }
out="$1"
mkdir -p "$out"
if [ -e "$out/proof.apk" ] || [ -e "$out/disks" ]; then echo "Refusing to overwrite existing media" >&2; exit 1; fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="$(node scripts/fetch-pinned-media.ts android "$work")"
gh attestation verify "$archive" --repo jqssun/android-lineage-qemu --format json > "$out/android-attestation.json"
node scripts/prepare-android.ts "$archive" "$work/disks" --authorized > "$out/android-disk-manifest.json"
test -f "$ANDROID_HOME/platforms/android-34/android.jar"
test -x "$ANDROID_HOME/build-tools/34.0.0/apksigner"
bash showcases/android/build-apk.sh "$out/proof.apk" > "$out/apk-build.txt"
"$ANDROID_HOME/build-tools/34.0.0/apksigner" verify --verbose --print-certs "$out/proof.apk" > "$out/apk-signature.txt"
"$ANDROID_HOME/build-tools/34.0.0/aapt2" dump badging "$out/proof.apk" > "$out/apk-badging.txt"
grep -F "package: name='org.vminterface.proof'" "$out/apk-badging.txt"
grep -F "versionName='3.0'" "$out/apk-badging.txt"
(cd "$out"; sha256sum proof.apk > apk.sha256)
# Retain only metadata and our fixture APK, not third-party disk images.

node scripts/write-showcase-scenario.ts android "$out/android-scenario.json"
node scripts/write-showcase-scenario.ts android "$out/android-adb-scenario.json" --android-transfer adb-saf
if [ "${2:-}" = --retain-disks ]; then mv "$work/disks" "$out/disks"; fi
