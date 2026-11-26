#!/usr/bin/env bash
set -euo pipefail
# Requires an authorized local Android SDK, JDK 17+, accepted SDK terms.
sdk="${ANDROID_HOME:?Set ANDROID_HOME to installed SDK}"
bt="$sdk/build-tools/34.0.0"
jar="$sdk/platforms/android-34/android.jar"
root="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$PWD/proof.apk}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$work/dex"
javac -source 8 -target 8 -cp "$jar" -d "$work/classes" "$root/ProofActivity.java"
"$bt/d8" --lib "$jar" --min-api 23 --output "$work/dex" "$work/classes/org/vminterface/proof/ProofActivity.class"
"$bt/aapt2" link -I "$jar" --manifest "$root/AndroidManifest.xml" -o "$work/base.apk"
(cd "$work/dex"; zip -q "$work/base.apk" classes.dex)
"$bt/zipalign" -f 4 "$work/base.apk" "$work/aligned.apk"
keytool -genkeypair -keyalg RSA -keysize 2048 -validity 365 -alias proof -dname "CN=Disposable VM Interface proof" -keystore "$work/test.p12" -storepass disposable-test -keypass disposable-test -storetype PKCS12
"$bt/apksigner" sign --ks "$work/test.p12" --ks-pass pass:disposable-test --key-pass pass:disposable-test --out "$out" "$work/aligned.apk"
"$bt/apksigner" verify --verbose "$out"
sha256sum "$out"
echo 'Proof output digest is bound to fresh API-uploaded challenge at runtime.'
