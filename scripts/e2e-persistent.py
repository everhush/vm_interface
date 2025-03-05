"""Real CDI/PVC lifecycle checks via the application API only.
This verifies storage identity/attachment, not guest-written byte persistence.
"""
import json, os, time, urllib.request, urllib.error, uuid
base=os.environ.get("API_URL","http://127.0.0.1:3000/api/v1")
a,b=os.environ["TOKEN_A"],os.environ["TOKEN_B"]
def key(): return uuid.uuid4().hex
def call(method,path,token=a,data=None,idem=None,expected=200):
    headers={"Authorization":"Bearer "+token}
    if data is not None: headers["Content-Type"]="application/json"
    if idem: headers["Idempotency-Key"]=idem
    req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=30) as r: status,result=r.status,json.load(r)
    except urllib.error.HTTPError as e: status,result=e.code,json.load(e)
    assert status==expected,(method,path,status,result)
    return result
os.makedirs("evidence",exist_ok=True)
def wait(label,check,seconds=600):
    end=time.monotonic()+seconds
    last=None
    while time.monotonic()<end:
        state=call("GET",path)
        storage=call("GET",path+"/storage")
        last={"stage":label,"vmiPhase":(state.get("instance") or {}).get("status",{}).get("phase"),"storage":storage}
        with open("evidence/persistent-storage.jsonl","a") as f: f.write(json.dumps(last)+"\n")
        if check(state,storage): return state,storage
        time.sleep(5)
    raise AssertionError(label+" failed: "+json.dumps(last))
def ready(state,storage):
    return (state.get("instance") or {}).get("status",{}).get("phase")=="Running" and len(storage["volumes"])==2 and all(
        v["dataVolumePhase"]=="Succeeded" and v["pvcPhase"]=="Bound" and v["pvcUid"] for v in storage["volumes"])
def identities(storage): return {v["kind"]:v["pvcUid"] for v in storage["volumes"]}
spec=dict(version=1,name="ci-persistent",architecture="amd64",cpu=1,memoryMiB=512,image="cirros-smoke",storage={"systemGiB":2,"exchangeGiB":1})
call("POST","/computers/plan",data=spec)
call("POST","/computers/plan",data={**spec,"storage":{"systemGiB":20,"exchangeGiB":1}},expected=422)
idem=key()
created=call("POST","/computers",data=spec,idem=idem,expected=202)
vm=created["result"]["id"]
path="/computers/"+vm
try:
    assert call("POST","/computers",data=spec,idem=idem,expected=202)==created
    call("GET",path+"/storage",token=b,expected=404)
    call("DELETE",path+"?deleteDisks=true",token=b,idem=key(),expected=404)
    call("DELETE",path,idem=key(),expected=409)
    call("POST",path+"/start",data={},idem=key(),expected=202)
    state,storage=wait("persistent-start",ready)
    original=identities(storage)
    assert len(set(original.values()))==2
    names={v["name"] for v in storage["volumes"]}
    attached={v["dataVolume"]["name"] for v in state["instance"]["spec"]["volumes"] if "dataVolume" in v}
    assert names==attached
    call("POST",path+"/stop",data={},idem=key(),expected=202)
    _,stopped=wait("persistent-stop",lambda s,d:s["instance"] is None and identities(d)==original)
    assert all(v["pvcPhase"]=="Bound" for v in stopped["volumes"])
    call("POST",path+"/start",data={},idem=key(),expected=202)
    _,restarted=wait("persistent-restart",ready)
    assert identities(restarted)==original
finally:
    deleted=call("DELETE",path+"?deleteDisks=true",idem=key(),expected=202)
    assert set(deleted["result"]["affectedDisks"])=={vm+"-boot",vm+"-exchange"}
end=time.monotonic()+180
while time.monotonic()<end:
    if all(x["id"]!=vm for x in call("GET","/computers")): break
    time.sleep(3)
else: raise AssertionError("Persistent VM still present")
call("GET",path+"/storage",expected=404)
print("Persistent CDI system/exchange volume identity survived stop/start; guest data not verified.")
