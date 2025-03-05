"""Actual product API upload -> real native guest -> download, never kubectl."""
import hashlib, json, os, secrets, time, urllib.request, urllib.error, uuid
from pathlib import Path

base=os.environ.get("API_URL","http://127.0.0.1:3000/api/v1")
a,b=os.environ["TOKEN_A"],os.environ["TOKEN_B"]
def key(): return uuid.uuid4().hex
def call(method,path,token=a,data=None,idem=None,expected=200,raw=None,digest=None,binary=False):
    headers={"Authorization":"Bearer "+token}
    if idem: headers["Idempotency-Key"]=idem
    if data is not None: headers["Content-Type"]="application/json"
    if raw is not None: headers["Content-Type"]="application/octet-stream"
    if digest: headers["X-Content-SHA256"]=digest
    body=raw if raw is not None else json.dumps(data).encode() if data is not None else None
    req=urllib.request.Request(base+path,data=body,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=45) as res: status,payload,response_headers=res.status,res.read(),res.headers
    except urllib.error.HTTPError as exc: status,payload,response_headers=exc.code,exc.read(),exc.headers
    assert status==expected,(method,path,status,payload[:500])
    return (payload,response_headers) if binary else json.loads(payload)
def sha(data): return hashlib.sha256(data).hexdigest()
cloud="""#!/bin/bash
set -eu
mkdir -p /mnt/exchange
modprobe virtiofs || true
mount -t virtiofs exchange /mnt/exchange
test "$(findmnt -n -o FSTYPE /mnt/exchange)" = virtiofs
cd /mnt/exchange
test -f in-challenge.bin
umask 002
(cat in-challenge.bin; printf '\\nactual-fedora-guest\\n') > .result.tmp
mv .result.tmp out-result.bin
sha256sum out-result.bin | cut -d ' ' -f 1 > .digest.tmp
mv .digest.tmp out-result.bin.sha256
sync
"""
spec=dict(version=1,name="ci-exchange",architecture="amd64",cpu=1,memoryMiB=1536,image="fedora-exchange-test",storage={"systemGiB":8,"exchangeGiB":1,"exchangeMode":"virtiofs"},cloudInit=cloud)
plan=call("POST","/computers/plan",data=spec)
assert plan["manifest"]["spec"]["template"]["spec"]["domain"]["devices"]["filesystems"][0]["name"]=="exchange"
created=call("POST","/computers",data=spec,idem=key(),expected=202)
vm=created["result"]["id"]
path="/computers/"+vm
try:
    payload=secrets.token_bytes(4096)
    digest=sha(payload)
    upload=path+"/files/challenge.bin"
    call("PUT",upload,token=b,raw=payload,digest=digest,idem=key(),expected=404)
    call("PUT",upload,raw=payload,digest="0"*64,idem=key(),expected=422)
    k=key()
    first=call("PUT",upload,raw=payload,digest=digest,idem=k,expected=202)
    assert first["result"]["sha256"]==digest and first["result"]["size"]==len(payload)
    assert call("PUT",upload,raw=payload,digest=digest,idem=k,expected=202)==first
    call("PUT",upload,raw=b"conflict",digest=sha(b"conflict"),idem=key(),expected=409)
    assert call("GET",path+"/files")==[]
    call("GET",path+"/files",token=b,expected=404)
    call("POST",path+"/start",data={},idem=key(),expected=202)
    deadline=time.monotonic()+600
    files=[]
    while time.monotonic()<deadline:
        files=call("GET",path+"/files")
        if any(f["name"]=="result.bin" for f in files): break
        time.sleep(3)
    else: raise AssertionError("No guest-published output")
    expected=payload+b"\nactual-fedora-guest\n"
    result,headers=call("GET",path+"/files/result.bin",binary=True)
    assert result==expected and headers["X-Content-SHA256"]==sha(expected)
    call("GET",path+"/files/result.bin",token=b,expected=404)
    before=call("GET",path+"/storage")
    assert len(before["volumes"])==2
    identities={x["kind"]:x["pvcUid"] for x in before["volumes"]}
    assert all(identities.values())
    call("POST",path+"/stop",data={},idem=key(),expected=202)
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        if call("GET",path)["instance"] is None: break
        time.sleep(3)
    else: raise AssertionError("Stop did not converge")
    stopped=call("GET",path+"/storage")
    assert {x["kind"]:x["pvcUid"] for x in stopped["volumes"]}==identities
    after,_=call("GET",path+"/files/result.bin",binary=True)
    assert after==expected
    Path("evidence/exchange-verification.json").write_text(json.dumps({"scope":"real-product-api","inputBytes":len(payload),"inputSha256":digest,"outputBytes":len(result),"outputSha256":sha(result),"nativeGuest":"Fedora","guestTransform":True,"crossAccountDenied":True,"idempotent":True,"stoppedDataPersistent":True,"pvcIdentities":identities},indent=2))
    print("Actual guest-visible VirtioFS file bytes and stopped persistence verified through API")
finally:
    call("DELETE",path,idem=key(),expected=409)
    call("DELETE",path+"?deleteDisks=true",idem=key(),expected=202)
