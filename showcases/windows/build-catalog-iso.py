#!/usr/bin/env python3
"""Repackage only exact driver files from independently verified pinned ISO."""
import argparse, hashlib, json, os, shutil, subprocess, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PIN=json.loads((ROOT/"driver-files.json").read_text())

def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f,"sha256").hexdigest()

def check(path,spec):
    if path.is_symlink() or not path.is_file() or ("bytes" in spec and path.stat().st_size!=spec["bytes"]) or digest(path)!=spec["sha256"]:
        raise ValueError("Pinned file differs: "+path.name)

def verify_report(report):
    if report.get("signatureVerificationPassed") is not True or report.get("isoSha256")!=PIN["iso"]["sha256"] or report.get("isoBytes")!=PIN["iso"]["bytes"]:
        raise ValueError("Driver ISO qualification missing")
    if any(report["catalog"].get(k)!=v for k,v in PIN["catalog"].items()):
        raise ValueError("Catalog identity mismatch")
    if sorted(x["name"] for x in report["files"])!=sorted(x["name"] for x in PIN["files"]):
        raise ValueError("Unexpected report files")
    for spec in PIN["files"]:
        f=next(x for x in report["files"] if x["name"]==spec["name"])
        if any(f.get(k)!=spec[k] for k in ("sha256","bytes")):
            raise ValueError("Driver report differs")
        if spec.get("catalogVerified") and f.get("catalogVerified") is not True:
            raise ValueError("Driver catalog membership missing")
        if "embeddedSignerThumbprint" in spec and (f.get("embeddedSignatureStatus")!="Valid" or f.get("embeddedSignerThumbprint")!=spec["embeddedSignerThumbprint"]):
            raise ValueError("Service signature mismatch")
    pkg=[x for x in report["packages"] if x["key"]=="winfsp"]
    if len(pkg)!=1 or pkg[0].get("signatureStatus")!="Valid" or any(pkg[0].get(k)!=PIN["winfsp"][k] for k in ("sha256","signerThumbprint")):
        raise ValueError("WinFsp signature mismatch")

def build(iso,winfsp,report,output):
    verify_report(json.loads(report.read_text(encoding="utf-8-sig")))
    check(iso,PIN["iso"]);check(winfsp,PIN["winfsp"])
    if output.exists() or output.is_symlink(): raise ValueError("Refusing output overwrite")
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as td:
        tmp=Path(td);media=tmp/"media";media.mkdir()
        for spec in [PIN["catalog"],*PIN["files"]]:
            dst=media/spec["name"]
            subprocess.run(["xorriso","-osirrox","on","-indev",str(iso),"-extract","/viofs/2k22/amd64/"+spec["name"],str(dst)],check=True,timeout=60)
            check(dst,spec)
        shutil.copyfile(winfsp,media/"winfsp.msi")
        shutil.copyfile(ROOT/"bootstrap-catalog.ps1",media/"bootstrap.ps1")
        shutil.copyfile(ROOT/"driver-files.json",media/"driver-files.json")
        tmpiso=tmp/"drivers.iso"
        subprocess.run(["xorriso","-as","mkisofs","-quiet","-R","-J","-V","VMDRIVERS","-o",str(tmpiso),str(media)],check=True,timeout=120)
        extracted=tmp/"extracted";extracted.mkdir()
        subprocess.run(["xorriso","-osirrox","on","-indev",str(tmpiso),"-extract","/",str(extracted)],check=True,timeout=60)
        expected={p.name:digest(p) for p in media.iterdir()}
        if {p.name:digest(p) for p in extracted.iterdir()}!=expected: raise ValueError("ISO readback mismatch")
        os.link(tmpiso,output)
        return {"sha256":digest(output),"bytes":output.stat().st_size,"sizeGiB":1,"readbackVerified":True,"files":expected,"guestCompatibilityVerified":False}
if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for x in ("iso","winfsp","report","output"):p.add_argument("--"+x,type=Path,required=True)
    p.add_argument("--authorized",action="store_true",required=True)
    a=p.parse_args()
    print(json.dumps(build(a.iso,a.winfsp,a.report,a.output),indent=2))
