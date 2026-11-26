"""Exact media/preflight/launch arguments for pinned native Android validation."""
import argparse,hashlib,json,subprocess
from pathlib import Path
from prepare_android import SOURCE,ARCHIVE_SHA,digest
from showcase_inputs import load_scenario
ROOT=Path(__file__).resolve().parents[1]
def arguments(root):
    manifest=json.loads((root/"android-disk-manifest.json").read_text())
    pinned=json.loads((ROOT/"showcases/android/pinned-disks.json").read_text())
    assert manifest["source"]==SOURCE and manifest["archiveSha256"]==ARCHIVE_SHA and manifest["architecture"]=="arm64"
    assert manifest["disks"]==pinned and manifest["bootCertified"] is False
    for name,p in pinned.items():
        f=root/"disks"/name
        assert f.is_file() and f.stat().st_size==p["bytes"] and digest(f)==p["sha256"],name
    apk=root/"proof.apk"
    scenario=root/"android-scenario.json"
    load_scenario(scenario,"android")
    badging=(root/"apk-badging.txt").read_text()
    assert "package: name='org.vminterface.proof'" in badging and "versionName='3.0'" in badging
    return ["--media",str(root/"disks/vda.qcow2"),"--media-sha256",pinned["vda.qcow2"]["sha256"],"--system-gib",str(pinned["vda.qcow2"]["sizeGiB"]),"--auxiliary-media",str(root/"disks/vdb.qcow2"),"--auxiliary-sha256",pinned["vdb.qcow2"]["sha256"],"--auxiliary-gib",str(pinned["vdb.qcow2"]["sizeGiB"]),"--source",SOURCE,"--version","v2026.10.18","--software",str(apk),"--software-sha256",digest(apk),"--scenario",str(scenario),"--authorize-media","--record-consent"]
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory",type=Path)
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-only",action="store_true")
    mode.add_argument("--confirm-disposable",action="store_true")
    a=p.parse_args();args=arguments(a.directory.resolve())
    if a.preflight_only:
        subprocess.run(["python3",str(ROOT/"scripts/showcase-native.py"),"android",*args,"--preflight-only"],check=True)
    else:
        subprocess.run(["bash",str(ROOT/"scripts/device-validate.sh"),"android","--confirm-disposable",*args],check=True)
if __name__=="__main__":main()
