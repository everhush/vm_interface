"""Real API-only cold data disk lifecycle, retention and isolation.
Checks PVC identity and effective attachment, not guest-written byte integrity."""
import hashlib, json, os, time, urllib.request, urllib.error, uuid
from pathlib import Path
base=os.environ.get("API_URL","http://127.0.0.1:3000/api/v1")
a,b=os.environ["TOKEN_A"],os.environ["TOKEN_B"]
def key(): return uuid.uuid4().hex
class ResponseMismatch(AssertionError):
    def __init__(self,method,path,status,result):
        super().__init__((method,path,status,result))
        self.status=status
        self.result=result

def call(method,path,data=None,token=a,idem=None,expected=200):
    h={"Authorization":"Bearer "+token}
    if data is not None: h["Content-Type"]="application/json"
    if idem: h["Idempotency-Key"]=idem
    req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=h,method=method)
    try:
        with urllib.request.urlopen(req,timeout=30) as res: status,result=res.status,json.load(res)
    except urllib.error.HTTPError as exc: status,result=exc.code,json.load(exc)
    if status!=expected: raise ResponseMismatch(method,path,status,result)
    return result
def wait(fn,seconds=420):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        value=fn()
        if value: return value
        time.sleep(3)
    raise AssertionError("Data disk convergence timed out")
spec=dict(version=1,name="ci-data-disk",architecture="amd64",cpu=1,memoryMiB=512,image="cirros-smoke",storage={"systemGiB":2,"exchangeGiB":1})
baseline=call("GET","/account/quota")["usage"]["storageGiB"]
vm=call("POST","/computers",spec,idem=key(),expected=202)["result"]["id"]
path="/computers/"+vm
def state(): return call("GET",path)
def disk(name="work"):
    return next((x for x in call("GET",path+"/storage")["volumes"] if x["kind"]=="data" and x["diskName"]==name),None)
def req(action,**kw): return dict(action=action,name="work",expectedResourceVersion=state()["resourceVersion"],**kw)
def version_conflict(exc):
    return exc.status==409 and exc.result.get("error") in (
        "VM identity or resource version changed",
        "VM resource version changed before disk reservation",
    )
def submit_disk(body):
    # Only known rejected optimistic-concurrency requests may be retried.
    # Reinspect desired state; never retry 502, unknown outcomes or semantic 409s.
    initial=state()["desired"]
    deadline=time.monotonic()+45
    while time.monotonic()<deadline:
        current=state()
        assert current["desired"]==initial,"Desired VM configuration changed during retry"
        body={**body,"expectedResourceVersion":current["resourceVersion"]}
        try:
            call("POST",path+"/disks/plan",body)
        except ResponseMismatch as exc:
            if not version_conflict(exc): raise
            time.sleep(1);continue
        current=state()
        assert current["desired"]==initial,"Desired VM configuration changed after plan"
        body["expectedResourceVersion"]=current["resourceVersion"]
        k=key()
        try:
            result=call("POST",path+"/disks",body,idem=k,expected=202)
        except ResponseMismatch as exc:
            if not version_conflict(exc): raise
            # The rejection must be durable; a replay cannot submit it again.
            call("POST",path+"/disks",body,idem=k,expected=409)
            time.sleep(1);continue
        assert result["status"]=="submitted",result
        assert call("POST",path+"/disks",body,idem=k,expected=202)==result
        return result
    raise AssertionError("Disk resource version did not stabilize")
def change(action,**kw):
    return submit_disk(req(action,**kw))
def stopped():
    s=state()
    return s if not s["instance"] and not (s.get("status") or {}).get("stateChangeRequests") and not (s.get("status") or {}).get("created") and not (s.get("status") or {}).get("ready") else None
def running(attached):
    s=state();i=s.get("instance") or {}
    if i.get("status",{}).get("phase")!="Running": return None
    v=[x for x in i.get("spec",{}).get("volumes",[]) if x["name"]=="data-work"]
    if attached:
        if len(v)!=1 or v[0].get("dataVolume",{}).get("name")!=vm+"-data-work": return None
    elif v: return None
    d=disk()
    return d if d and d["attached"]==attached and d["dataVolumePhase"]=="Succeeded" and d["pvcUid"] else None
export_path=None
def export_gone(ep):
    try: call("GET",ep)
    except AssertionError as e:
        if e.args and isinstance(e.args[0],tuple) and e.args[0][2]==404:return True
        raise
    return False
try:
    wait(stopped)
    call("POST",path+"/disks",req("create",sizeGiB=1),token=b,idem=key(),expected=404)
    change("create",sizeGiB=1)
    created=wait(lambda: (d if (d:=disk()) and d.get("dataVolumeUid") and not d["attached"] else None))
    assert call("GET","/account/quota")["usage"]["storageGiB"]==baseline+4
    change("attach")
    call("POST",path+"/start",{},idem=key(),expected=202)
    initial=wait(lambda:running(True))
    assert initial["dataVolumeUid"]==created["dataVolumeUid"]
    call("POST",path+"/disks",req("detach"),idem=key(),expected=409)
    call("POST",path+"/stop",{},idem=key(),expected=202);wait(stopped)
    change("detach")
    detached=disk();assert detached and not detached["attached"] and detached["pvcUid"]==initial["pvcUid"]
    assert call("GET","/account/quota")["usage"]["storageGiB"]==baseline+4
    call("POST",path+"/start",{},idem=key(),expected=202);wait(lambda:running(False))
    call("POST",path+"/stop",{},idem=key(),expected=202);wait(stopped)
    change("attach");call("POST",path+"/start",{},idem=key(),expected=202)
    final=wait(lambda:running(True))
    assert final["pvcUid"]==initial["pvcUid"] and final["dataVolumeUid"]==initial["dataVolumeUid"]
    call("POST",path+"/stop",{},idem=key(),expected=202);wait(stopped)
    body=dict(action="clone",name="copy",source="work",sizeGiB=2,expectedResourceVersion=state()["resourceVersion"])
    cloned=submit_disk(body)
    copy=wait(lambda: (d if (d:=disk("copy")) and d.get("dataVolumePhase")=="Succeeded" and d.get("pvcPhase")=="Bound" and d.get("pvcUid") else None))
    assert copy["pvcUid"]!=final["pvcUid"] and copy["source"]=="work" and not copy["attached"] and copy["sizeGiB"]==2
    assert disk()["pvcUid"]==final["pvcUid"] and disk()["sizeGiB"]==1
    wait(lambda:call("GET","/operations/"+cloned["operationId"]).get("observation",{}).get("state")=="converged")
    assert call("GET","/account/quota")["usage"]["storageGiB"]==baseline+6
    # Imported independent raw disk; prove server-side declared hash, CDI identity and ownership.
    payload=b"VM interface imported disk fixture"+b"\x00"*(1024*1024-34)
    digest=hashlib.sha256(payload).hexdigest()
    body=dict(action="import",name="imported",sizeGiB=1,expectedResourceVersion=state()["resourceVersion"],media=dict(format="raw",bytes=len(payload),sha256=digest,source="ci fixture",os="test",version="1",authorizedByClient=True))
    submit_disk(body)
    endpoint=path+"/media/data-imported"
    call("GET",endpoint,token=b,expected=404)
    wait(lambda:call("GET",endpoint)["phase"]=="UploadReady")
    attach=dict(action="attach",name="imported",expectedResourceVersion=state()["resourceVersion"])
    call("POST",path+"/disks/plan",attach,expected=409)
    def upload(data,expected):
        req=urllib.request.Request(base+endpoint,data=data,headers={"Authorization":"Bearer "+a,"Idempotency-Key":key(),"Content-Type":"application/octet-stream"},method="PUT")
        try:
            with urllib.request.urlopen(req,timeout=180) as res: status,result=res.status,json.load(res)
        except urllib.error.HTTPError as exc: status,result=exc.code,json.load(exc)
        assert status==expected,(status,result)
    upload(b"!"*len(payload),422)
    upload(payload,202)
    imported=wait(lambda: (s if (s:=call("GET",endpoint))["ready"] else None))
    assert imported["metadata"]["sha256"]==digest
    export=call("POST",path+"/disk-exports/imported",idem=key(),expected=202)["result"]["exportId"]
    ep=path+"/disk-exports/"+export
    export_path=ep
    call("GET",ep,token=b,expected=404)
    call("POST",path+"/start",{},idem=key(),expected=409)
    wait(lambda:call("GET",ep)["ready"])
    req=urllib.request.Request(base+ep+"/file",headers={"Authorization":"Bearer "+a})
    with urllib.request.urlopen(req,timeout=180) as res:
        length=int(res.headers["Content-Length"]); prefix=res.read(len(payload)); total=len(prefix); h=hashlib.sha256(prefix)
        assert prefix==payload
        while chunk:=res.read(1024*1024): total+=len(chunk); h.update(chunk)
        assert total==length and length<=1024**3
    exported={"bytes":total,"sha256":h.hexdigest(),"inputPrefixVerified":True}
    call("DELETE",ep,idem=key(),expected=202)
    wait(lambda:export_gone(ep))
    export_path=None
    assert call("GET","/account/quota")["usage"]["storageGiB"]==baseline+7
    # Boot and block exchange are distinct owned native export sources.
    system_exports={}
    for selector,claim_suffix,capacity in [("system.disk","-boot",2),("exchange.disk","-exchange",1)]:
        created_export=call("POST",path+"/disk-exports/"+selector,idem=key(),expected=202)["result"]
        assert created_export["disk"]==selector
        ep=path+"/disk-exports/"+created_export["exportId"]
        export_path=ep
        call("GET",ep,token=b,expected=404)
        wait(lambda:call("GET",ep)["ready"])
        req=urllib.request.Request(base+ep+"/file",headers={"Authorization":"Bearer "+a})
        with urllib.request.urlopen(req,timeout=180) as res:
            length=int(res.headers["Content-Length"])
            assert 0<length<=capacity*1024**3
            assert vm+claim_suffix+".raw" in res.headers["Content-Disposition"]
            h=hashlib.sha256();total=0
            while chunk:=res.read(1024*1024): h.update(chunk);total+=len(chunk)
            assert total==length
        system_exports[selector]={"bytes":total,"sha256":h.hexdigest()}
        call("DELETE",ep,idem=key(),expected=202)
        wait(lambda:export_gone(ep))
        export_path=None
    call("DELETE",path,idem=key(),expected=409)
    Path("evidence").mkdir(exist_ok=True)
    Path("evidence/data-disks.json").write_text(json.dumps({"initial":initial,"detached":detached,"reattached":final,"clone":copy,"import":imported,"export":exported,"systemExports":system_exports,"guestByteProof":False},indent=2))
finally:
    if export_path and not export_gone(export_path):
        call("DELETE",export_path,idem=key(),expected=202)
        wait(lambda:export_gone(export_path))
    # Do not obscure an earlier failure with assertions about disks never created.
    reservations={vm+"-data-"+v["diskName"] for v in call("GET",path+"/storage")["volumes"] if v["kind"]=="data"}
    deletion=call("DELETE",path+"?deleteDisks=true",idem=key(),expected=202)
    assert reservations<=set(deletion["result"]["affectedDisks"])
    if "copy" in locals() and copy: assert vm+"-data-copy" in deletion["result"]["affectedDisks"]
    if "imported" in locals() and imported: assert vm+"-data-imported" in deletion["result"]["affectedDisks"]
wait(lambda:call("GET","/operations/"+deletion["operationId"]).get("observation",{}).get("state")=="converged")
assert call("GET","/account/quota")["usage"]["storageGiB"]==baseline
print("Real cold data disk lifecycle and stable PVC identities passed; guest data verification remains separate.")
