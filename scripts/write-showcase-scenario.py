"""Materialize bundled scenario inputs with exact fixture digests; no guest execution."""
import hashlib,json,argparse
from pathlib import Path
SCENARIOS={"windows":{"setup":[{"human":"Complete authorized Windows Server 2022 Desktop Experience installation to the first reboot; do not enter credentials in this client."},{"system-boot":True},{"human":"Complete authorized login and setup; open an elevated PowerShell prompt, then release the human control ticket."}],"softwareSetup":[],"application":[{"wait":{"text":"proof.7z","seconds":45}}],"beforeMarker":"VMDRIVERSREADY","afterMarker":"proof.7z","resultName":"result.txt","expectedResultSha256":""},"android":{"setup":[{"human":"Complete authorized LineageOS 23.2 ARM64 first-run setup and verify that the exchange mount is accessible through the file picker."}],"softwareSetup":[{"human":"Install API-uploaded in-proof.apk via the authorized package installer, open VM Interface Proof, select the actual exchange directory and release control."}],"application":[{"click-label":{"text":"Compute proof","seconds":20}},{"wait":{"text":"APKCOMPLETE arm64-v8a","seconds":25}}],"beforeMarker":"APKREADY arm64-v8a","afterMarker":"APKCOMPLETE arm64-v8a","resultName":"result.txt","expectedResultSha256":""}}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("profile",choices=SCENARIOS);p.add_argument("output",type=Path);a=p.parse_args()
    scenario=SCENARIOS[a.profile]
    result=b"VM Interface Windows 7-Zip functional proof\n" if a.profile=="windows" else b"VM Interface Android APK functional proof\n"
    scenario["expectedResultSha256"]=hashlib.sha256(result).hexdigest()
    with a.output.open("x") as out:json.dump(scenario,out,indent=2);out.write("\n")
if __name__=="__main__":main()
