"""API-only real CSI qualification. Measure actual VirtioFS capacity in the
guest, preserve random bytes and PVC identity, distinguish PVC and guest disk.
"""
import hashlib,json,os,runpy,secrets,time,uuid
from pathlib import Path
os.environ["PROOF_OUTPUT_DIR"]="evidence/csi-growth"
h=runpy.run_path(str(Path(__file__).with_name("e2e-api-control-proof.py")),run_name="proof_helpers")
call,wait=h["call"],h["wait"]
OUT,A,B=h["OUT"],h["A"],h["B"]
GIB=1024**3
CLOUD=r"""#!/bin/bash
set -eu
mkdir -p /mnt/exchange
cat >/usr/local/bin/measure-exchange.py <<'PY'
import hashlib, os
from pathlib import Path
root=Path("/mnt/exchange")
payload=(root/"in-challenge.bin").read_bytes()
index="after" if (root/"out-before.bin").exists() else "before"
st=os.statvfs(root)
data=str(st.f_blocks*st.f_frsize).encode()+b"\n"+hashlib.sha256(payload).hexdigest().encode()+b"\n"
for suffix,content in [("",data),(".sha256",hashlib.sha256(data).hexdigest().encode()+b"\n")]:
    tmp=root/(".measure"+suffix+".tmp")
    tmp.write_bytes(content)
    os.replace(tmp,root/("out-"+index+".bin"+suffix))
os.sync()
PY
cat >/etc/systemd/system/measure-exchange.service <<'UNIT'
[Unit]
Description=Measure actual guest exchange filesystem
[Service]
Type=oneshot
ExecStartPre=/usr/bin/mount -t virtiofs exchange /mnt/exchange
ExecStartPre=/usr/bin/findmnt -n -t virtiofs /mnt/exchange
ExecStart=/usr/bin/python3 /usr/local/bin/measure-exchange.py
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now measure-exchange.service
"""
def quota():return call("GET","/account/quota")["usage"]["storageGiB"]
def main():
    baseline=quota()
    spec={"version":1,"name":"csi-growth","architecture":"amd64","cpu":1,"memoryMiB":1536,"image":"fedora-exchange-test","storage":{"systemGiB":6,"exchangeGiB":1,"exchangeMode":"virtiofs"},"cloudInit":CLOUD}
    created=call("POST","/computers",body=spec,expected=202,phase="create")
    path="/computers/"+created["result"]["id"]
    def state():return call("GET",path)
    def volumes():return {v["kind"]:v for v in call("GET",path+"/storage")["volumes"]}
    def stopped():
        s=state();status=s.get("status") or {}
        return s if not s["instance"] and s["desired"]["runStrategy"]=="Halted" and not any(status.get(k) for k in ("created","ready","stateChangeRequests")) else None
    def running():
        s=state();i=s["instance"] or {}
        return i.get("metadata",{}).get("uid") if i.get("status",{}).get("phase")=="Running" else None
    def download(name):
        wait(lambda:any(f["name"]==name for f in call("GET",path+"/files")),600,"Guest measurement not published")
        data,headers=call("GET",path+"/files/"+name,binary=True,phase="guest measurement")
        assert headers["X-Content-SHA256"]==hashlib.sha256(data).hexdigest()
        call("GET",path+"/files/"+name,token=B,expected=404)
        (OUT/name).write_bytes(data)
        size,digest=data.decode().splitlines()
        return int(size),digest
    try:
        wait(lambda:volumes()["exchange"]["pvcPhase"]=="Bound",300,"CSI exchange claim not bound")
        payload=secrets.token_bytes(4096);digest=hashlib.sha256(payload).hexdigest()
        upload=call("PUT",path+"/files/challenge.bin",raw=payload,expected=202,extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":digest},phase="upload")
        assert upload["result"]["sha256"]==digest
        call("POST",path+"/start",body={},expected=202)
        uid=wait(running,600,"Guest did not boot")
        before=download("before.bin")
        assert before[1]==digest and 0<before[0]<=GIB,before
        original=volumes()
        assert all(v["pvcUid"] and v["pvcPhase"]=="Bound" for v in original.values())
        call("POST",path+"/stop",body={},expected=202);wait(stopped,240,"Stop did not converge")
        def grow(disk,size):
            initial=state()["desired"]
            end=time.monotonic()+60
            while time.monotonic()<end:
                current=stopped();assert current and current["desired"]==initial
                body={"disk":disk,"sizeGiB":size,"expectedResourceVersion":current["resourceVersion"]}
                response=call("POST",path+"/storage/plan",body=body,expected=(200,409))
                if response.get("error"):
                    assert response["error"] in ("VM identity or resource version changed","Kubernetes rejected request (409)"),response
                    time.sleep(2);continue
                current=stopped();assert current and current["desired"]==initial
                body["expectedResourceVersion"]=current["resourceVersion"]
                key=str(uuid.uuid4())
                response=call("PATCH",path+"/storage",body=body,idem=key,expected=(202,409),phase="growth submit")
                if response.get("error"):
                    assert response["error"] in ("VM identity or resource version changed","Kubernetes rejected request (409)"),response
                    assert call("PATCH",path+"/storage",body=body,idem=key,expected=409)==response
                    time.sleep(2);continue
                assert response["status"]=="submitted",response
                assert call("PATCH",path+"/storage",body=body,idem=key,expected=202)==response
                return response
            raise AssertionError("Growth version conflict did not stabilize")
        body={"disk":"exchange.disk","sizeGiB":2,"expectedResourceVersion":state()["resourceVersion"]}
        call("PATCH",path+"/storage",token=B,body=body,expected=404)
        call("PATCH",path+"/storage",body={**body,"expectedResourceVersion":"stale"},expected=409)
        assert quota()==baseline+7
        exchange=grow("exchange.disk",2)
        assert quota()==baseline+8
        reserved=volumes()["exchange"]["growth"]
        assert reserved["reservedGiB"]==2 and reserved["submitted"] is True,reserved
        boot=grow("system.disk",8)
        assert quota()==baseline+10
        call("PATCH",path+"/storage",body={"disk":"exchange.disk","sizeGiB":1,"expectedResourceVersion":state()["resourceVersion"]},expected=422)
        call("POST",path+"/start",body={},expected=202)
        new_uid=wait(running,600,"Guest did not restart after PVC growth")
        after=download("after.bin")
        assert new_uid!=uid and after[1]==digest and before[0]<after[0]<=2*GIB,after
        assert after[0]>=before[0]+GIB*0.75,(before,after)
        assert download("before.bin")==before
        def converged():
            current=volumes()
            return current if all(v["growth"] and v["growth"]["pvcCapacityConverged"] for v in current.values()) else None
        final=wait(converged,300,"Native CSI growth did not converge")
        assert {k:v["pvcUid"] for k,v in original.items()}=={k:v["pvcUid"] for k,v in final.items()}
        for v in final.values():
            assert not v["growth"]["guestDiskGrowthVerified"] and not v["growth"]["guestFilesystemGrowthVerified"]
        for op in (exchange,boot):
            wait(lambda:call("GET","/operations/"+op["operationId"]).get("observation",{}).get("state")=="converged",120,"Growth operation not reconciled")
        call("POST",path+"/stop",body={},expected=202);wait(stopped,240,"Final stop did not converge")
        bundle,headers=call("GET",path+"/exchange-bundle",binary=True)
        assert headers["X-Content-SHA256"]==hashlib.sha256(bundle).hexdigest()
        (OUT/"exchange-bundle.tar").write_bytes(bundle)
        report={"runId":os.environ.get("GITHUB_RUN_ID"),"commit":os.environ.get("GITHUB_SHA"),"original":original,"expanded":final,"guestBeforeBytes":before[0],"guestAfterBytes":after[0],"inputSha256":digest,"actualVirtioFsGrowthVerified":True,"virtualBootDiskGrowthVerified":False,"guestBootFilesystemGrowthVerified":False,"samePvcIdentities":True,"crossAccountDenied":True,"quotaReserved":True}
        (OUT/"verification.json").write_text(json.dumps(report,indent=2)+"\n")
    finally:
        deletion=call("DELETE",path+"?deleteDisks=true",expected=202)
        wait(lambda:call("GET","/operations/"+deletion["operationId"]).get("observation",{}).get("state")=="converged",240,"Delete did not converge")
        assert quota()==baseline
    print("Real CSI PVC expansion and actual guest VirtioFS capacity increase verified")
if __name__=="__main__":main()
