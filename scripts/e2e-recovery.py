"""API-driven state before and after an infrastructure-injected API pod restart."""
import json,os,sys,time,urllib.request,urllib.error,uuid
from pathlib import Path
base=os.environ.get("API_URL","http://127.0.0.1:3000/api/v1")
a,b=os.environ["TOKEN_A"],os.environ["TOKEN_B"]
def key(): return uuid.uuid4().hex
def call(method,path,token=a,data=None,idem=None,expected=200):
    headers={"Authorization":"Bearer "+token}
    if data is not None: headers["Content-Type"]="application/json"
    if idem: headers["Idempotency-Key"]=idem
    req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=45) as r: status,result=r.status,json.load(r)
    except urllib.error.HTTPError as e: status,result=e.code,json.load(e)
    assert status==expected,(method,path,status,result)
    return result
def wait(check,seconds=420):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        result=check()
        if result: return result
        time.sleep(3)
    raise AssertionError("Recovery state did not converge")
def observed(op):
    x=call("GET","/operations/"+op)
    return x if (x.get("observation") or {}).get("state")=="converged" else None
statefile=Path("/tmp/vm-recovery.json")
if sys.argv[1]=="before":
    spec=dict(version=1,name="ci-recovery",architecture="amd64",cpu=1,memoryMiB=512,image="cirros-smoke")
    createkey,startkey=key(),key()
    created=call("POST","/computers",data=spec,idem=createkey,expected=202)
    path="/computers/"+created["result"]["id"]
    started=call("POST",path+"/start",data={},idem=startkey,expected=202)
    def running():
        x=call("GET",path).get("instance")
        return x["metadata"]["uid"] if x and x["status"]["phase"]=="Running" else None
    uid=wait(running)
    wait(lambda:observed(created["operationId"]))
    wait(lambda:observed(started["operationId"]))
    statefile.write_text(json.dumps(dict(spec=spec,createkey=createkey,startkey=startkey,created=created,started=started,uid=uid,path=path)))
    statefile.chmod(0o600)
else:
    state=json.loads(statefile.read_text())
    path=state["path"]
    try:
        assert call("POST","/computers",data=state["spec"],idem=state["createkey"],expected=202)==state["created"]
        assert call("POST",path+"/start",data={},idem=state["startkey"],expected=202)==state["started"]
        assert call("GET",path)["instance"]["metadata"]["uid"]==state["uid"]
        assert sum(x["id"]==state["created"]["result"]["id"] for x in call("GET","/computers"))==1
        assert observed(state["started"]["operationId"])
        history=call("GET","/operations")
        assert any(x["id"]==state["started"]["operationId"] for x in history)
        call("GET","/operations/"+state["started"]["operationId"],token=b,expected=404)
        stopped=call("POST",path+"/stop",data={},idem=key(),expected=202)
        wait(lambda:observed(stopped["operationId"]))
        deleted=call("DELETE",path,idem=key(),expected=202)
        wait(lambda:observed(deleted["operationId"]))
        Path("evidence/recovery-verification.json").write_text(json.dumps({"apiDeploymentRestart":True,"sameInstanceUid":state["uid"],"idempotentCreateAndStart":True,"durableOperationHistory":True,"observedStopAndDelete":True,"crossAccountDenied":True},indent=2))
        print("Real API restart preserved VM identity, idempotency and durable convergence evidence")
    finally:
        # If a prior assertion fails, attempt cleanup via the API only.
        try: call("DELETE",path,idem=key(),expected=202)
        except AssertionError: pass
