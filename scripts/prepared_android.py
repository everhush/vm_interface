"""Exact media/preflight/launch arguments for pinned native Android validation."""
import argparse,json,os,shutil,subprocess
from pathlib import Path
from prepare_android import SOURCE,ARCHIVE_SHA,digest
from showcase_inputs import load_scenario
from apk_manifest_check import verify_proof_apk_metadata
ROOT=Path(__file__).resolve().parents[1]
def arguments(root,transfer="virtiofs-saf"):
    manifest=json.loads((root/"android-disk-manifest.json").read_text())
    pinned=json.loads((ROOT/"showcases/android/pinned-disks.json").read_text())
    assert manifest["source"]==SOURCE and manifest["archiveSha256"]==ARCHIVE_SHA and manifest["architecture"]=="arm64"
    assert manifest["disks"]==pinned and manifest["bootCertified"] is False
    for name,p in pinned.items():
        f=root/"disks"/name
        assert f.is_file() and f.stat().st_size==p["bytes"] and digest(f)==p["sha256"],name
    apk=root/"proof.apk"
    expected=(root/"apk.sha256").read_text().split()
    assert expected==[digest(apk),"proof.apk"],"APK checksum mismatch"
    scenario=root/("android-adb-scenario.json" if transfer=="adb-saf" else "android-scenario.json")
    load_scenario(scenario,"android")
    # Revalidate the actual APK, not a detached report that could be stale.
    sdk=os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    tools=Path(sdk)/"build-tools"/"34.0.0" if sdk else None
    # apksigner.jar is Java, so ARM64 devices do not need the x86 SDK aapt2.
    jar=Path(os.environ["APKSIGNER_JAR"]) if "APKSIGNER_JAR" in os.environ else tools/"lib"/"apksigner.jar" if tools else None
    if jar and jar.is_file():
        java=shutil.which("java")
        if not java:raise ValueError("Java runtime required for portable apksigner.jar")
        signer=[java,"-jar",str(jar)]
    else:
        path=shutil.which("apksigner")
        if not path:raise ValueError("Provide authorized apksigner.jar or apksigner in PATH")
        signer=[path]
    subprocess.run(signer+["verify","--verbose",str(apk)],check=True,stdout=subprocess.DEVNULL,timeout=60)
    verify_proof_apk_metadata(apk)
    return ["--media",str(root/"disks/vda.qcow2"),"--media-sha256",pinned["vda.qcow2"]["sha256"],"--system-gib",str(pinned["vda.qcow2"]["sizeGiB"]),"--auxiliary-media",str(root/"disks/vdb.qcow2"),"--auxiliary-sha256",pinned["vdb.qcow2"]["sha256"],"--auxiliary-gib",str(pinned["vdb.qcow2"]["sizeGiB"]),"--source",SOURCE,"--version","v2026.10.18","--software",str(apk),"--software-sha256",digest(apk),"--scenario",str(scenario),"--authorize-media","--record-consent"]
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory",type=Path)
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-only",action="store_true")
    mode.add_argument("--confirm-disposable",action="store_true")
    p.add_argument("--transfer",choices=["virtiofs-saf","adb-saf"],default="virtiofs-saf")
    p.add_argument("--authorize-android-debug",action="store_true")
    a=p.parse_args()
    if (a.transfer=="adb-saf")!=a.authorize_android_debug:p.error("adb-saf requires explicit debug authorization")
    if a.confirm_disposable and a.transfer=="adb-saf":
        adb=shutil.which("adb")
        if not adb:p.error("Install native Android platform-tools adb before provisioning")
        subprocess.run([adb,"version"],check=True,timeout=15)
    args=arguments(a.directory.resolve(),a.transfer)+["--android-transfer",a.transfer]
    if a.authorize_android_debug:args+=["--authorize-android-debug"]
    if a.preflight_only:
        subprocess.run(["python3",str(ROOT/"scripts/showcase-native.py"),"android",*args,"--preflight-only"],check=True)
    else:
        subprocess.run(["bash",str(ROOT/"scripts/device-validate.sh"),"android","--confirm-disposable",*args],check=True)
if __name__=="__main__":main()
