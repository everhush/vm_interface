"""Independently validate retained real CSI growth evidence, not hardware certification."""
import argparse
import hashlib
import json
import re
import tarfile
from pathlib import Path

GIB = 1024**3

def require(ok, message):
    if not ok:
        raise ValueError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def capacity(value):
    m=re.fullmatch(r"([0-9]+)(Gi|Mi)?",value)
    if not m:raise ValueError("Unexpected PVC capacity")
    return int(m[1])*{None:1,"Gi":GIB,"Mi":1024**2}[m[2]]

def verify(root, commit=None):
    folder=root/"csi-growth"
    proof=json.loads((folder/"verification.json").read_text())
    require(re.fullmatch(r"[a-f0-9]{40}",proof["commit"]) and str(proof["runId"]).isdigit(),"Missing hosted source identity")
    if commit:require(proof["commit"]==commit,"Unexpected source commit")
    for flag in ("actualVirtioFsGrowthVerified","samePvcIdentities","crossAccountDenied","quotaReserved"):
        require(proof[flag] is True,"Missing "+flag)
    for flag in ("virtualBootDiskGrowthVerified","guestBootFilesystemGrowthVerified"):
        require(proof[flag] is False,"PVC growth must not be reported as guest boot disk/filesystem growth")
    old,new=proof["original"],proof["expanded"]
    require(set(old)==set(new)=={"boot","exchange"},"Unexpected PVC set")
    for kind,size in (("boot",8),("exchange",2)):
        a,b=old[kind],new[kind]
        require(a["kind"]==b["kind"]==kind and a["name"]==b["name"] and a["pvcUid"] and a["pvcUid"]==b["pvcUid"] and a["pvcPhase"]==b["pvcPhase"]=="Bound","PVC identity or phase changed")
        require(capacity(a["capacity"])<capacity(b["capacity"]) and capacity(b["capacity"])>=size*GIB,"PVC capacity did not increase")
        require(b["growth"]["reservedGiB"]==size and b["growth"]["submitted"] is True and b["growth"]["pvcCapacityConverged"] is True,"Missing durable growth reservation/convergence")
        require(b["growth"]["guestDiskGrowthVerified"] is False and b["growth"]["guestFilesystemGrowthVerified"] is False,"Unsupported guest growth claim")
    require(old["boot"]["dataVolumeUid"] and old["boot"]["dataVolumeUid"]==new["boot"]["dataVolumeUid"],"Boot DataVolume identity changed")
    require(old["exchange"]["mode"]==new["exchange"]["mode"]=="virtiofs","Wrong exchange mode")
    challenge_hash=proof["inputSha256"]
    measurements={}
    for name in ("before","after"):
        data=(folder/(name+".bin")).read_bytes()
        size,hash_value=data.decode("ascii").splitlines()
        require(hash_value==challenge_hash and size.isdigit(),"Guest challenge digest/measurement invalid")
        measurements[name]=(int(size),data)
    before,after=measurements["before"][0],measurements["after"][0]
    require(before==proof["guestBeforeBytes"] and after==proof["guestAfterBytes"] and 0<before<=GIB and before+GIB*3//4<=after<=2*GIB,"Guest capacity did not materially increase")
    bundle=folder/"exchange-bundle.tar"
    require(bundle.stat().st_size<=1024**2,"Oversized evidence bundle")
    names={"upload/challenge.bin","download/before.bin","download/after.bin","manifest.json"}
    with tarfile.open(bundle,"r:") as archive:
        members=archive.getmembers()
        require(len(members)==len(names) and {m.name for m in members}==names and all(m.isfile() and m.size<=65536 for m in members),"Unexpected bundle members")
        challenge=archive.extractfile("upload/challenge.bin").read()
        require(len(challenge)==4096 and digest(challenge)==challenge_hash,"Bundled challenge mismatch")
        content={"upload/challenge.bin":challenge}
        for name,(_,expected) in measurements.items():
            key="download/"+name+".bin"
            content[key]=archive.extractfile(key).read()
            require(content[key]==expected,"Guest measurement bytes differ from bundle")
        manifest=json.load(archive.extractfile("manifest.json"))
        expected=[{"name":name,"bytes":len(data),"sha256":digest(data),"direction":name.split("/")[0]} for name,data in content.items()]
        require(manifest["version"]==1 and manifest["scope"]=="published-exchange-files-only" and sorted(manifest["files"],key=lambda x:x["name"])==sorted(expected,key=lambda x:x["name"]),"Bundle manifest mismatch")
    for filename,claim in (("csi-admission-readiness.txt","vm-growth-admission-sentinel"),("csi-denied-patch.txt","vm-recordings")):
        data=(root/filename).read_text()
        require(claim in data and "ValidatingAdmissionPolicy 'vm-pvc-growth'" in data and "denied request" in data,"Admission denial missing: "+claim)
    storage=json.loads((root/"csi-storageclass.json").read_text())
    require(storage["allowVolumeExpansion"] is True and storage["provisioner"]=="rawfile.csi.openebs.io" and storage["metadata"]["name"]=="vm-expandable","Wrong expandable storage backend")
    rows=[json.loads(line) for line in (folder/"http-trace.jsonl").read_text().splitlines() if line]
    require(rows and all(row["status"]==row["expected"] and set(row)<={"elapsedMs","method","path","status","expected","responseMs","phase"} for row in rows),"Trace contains failed requests or unexpected fields")
    require(sum(row.get("phase")=="growth submit" and row["status"]==202 for row in rows)==2,"Two successful growth requests not observed")
    require({404,409,422}<={row["status"] for row in rows if row["method"]=="PATCH" and row["path"].endswith("/storage")},"Missing ownership, version and shrink denials")
    return {"commit":proof["commit"],"runId":proof["runId"],"guestBeforeBytes":before,"guestAfterBytes":after,"bundleSha256":digest(bundle.read_bytes()),"httpCalls":len(rows),"hardwareCertifiedByVerifier":False,"virtualBootDiskGrowthVerified":False,"guestBootFilesystemGrowthVerified":False}

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--commit")
    a=p.parse_args()
    print(json.dumps(verify(a.root,a.commit),indent=2))
