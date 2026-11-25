#!/usr/bin/env python3
"""Fail before real CI when runner storage is insufficient; never alter eviction policy."""
import argparse, json, shutil, subprocess
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument("stage",choices=["before-provision","after-provision","after-build"])
p.add_argument("minimum_gib",type=int)
a=p.parse_args()
usage=shutil.disk_usage("/")
report={"stage":a.stage,"freeBytes":usage.free,"totalBytes":usage.total,"minimumGiB":a.minimum_gib}
if a.stage!="before-provision":
    nodes=json.loads(subprocess.check_output(["kubectl","get","nodes","-o","json"],text=True))["items"]
    report["diskPressure"]=[n["metadata"]["name"] for n in nodes if any(c["type"]=="DiskPressure" and c["status"]!="False" for c in n["status"]["conditions"])]
else:
    report["diskPressure"]=[]
report["passed"]=usage.free>=a.minimum_gib*1024**3 and not report["diskPressure"]
Path("evidence").mkdir(exist_ok=True)
Path("evidence/runner-space-"+a.stage+".json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report))
raise SystemExit(0 if report["passed"] else 1)
