"""Materialize bundled scenario inputs with exact fixture digests; no guest execution."""
import hashlib,json,argparse
from pathlib import Path
from android_fixture import ANDROID_RESULT_MODE
SCENARIOS={"windows":{"setup":[{"human":"Complete authorized Windows Server 2022 Desktop Experience installation to the first reboot; do not enter credentials in this client."},{"system-boot":True},{"human":"Complete authorized login and setup; open an elevated PowerShell prompt, then release the human control ticket."}],"softwareSetup":[],"application":[{"wait":{"text":"proof.7z","seconds":45}}],"beforeMarker":"VMDRIVERSREADY","afterMarker":"proof.7z","resultName":"result.txt","expectedResultSha256":""},"android":{"setup":[{"human":"Complete authorized LineageOS 23.2 ARM64 first-run setup and verify that the exchange mount is accessible through the file picker."}],"softwareSetup":[{"human":"Install uploaded in-proof.apk, open VM Interface Proof, select the authorized exchange directory containing the challenge, then release control."}],"application":[{"click-label":{"text":"Compute proof","seconds":20}},{"wait":{"text":"APKCOMPLETE arm64-v8a","seconds":25}}],"beforeMarker":"APKREADY arm64-v8a","afterMarker":"APKCOMPLETE arm64-v8a","resultName":"result.txt","expectedResultSha256":""}}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("profile",choices=SCENARIOS);p.add_argument("output",type=Path);a=p.parse_args()
    scenario=SCENARIOS[a.profile]
    scenario["expectedResultSha256"]=hashlib.sha256(b"VM Interface Windows 7-Zip functional proof\n").hexdigest() if a.profile=="windows" else ANDROID_RESULT_MODE
    with a.output.open("x") as out:json.dump(scenario,out,indent=2);out.write("\n")
if __name__=="__main__":main()
