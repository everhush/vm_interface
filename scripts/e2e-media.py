"""Real API-only media import and guest display proof with pinned public smoke disk."""
import hashlib,http.client,json,os,sys,time,urllib.request,urllib.error,uuid
from pathlib import Path
from media_http import binary_request
from evidence_frames import ocr
base=os.environ.get("API_URL","http://127.0.0.1:3000/api/v1")
a,b=os.environ["TOKEN_A"],os.environ["TOKEN_B"]
def key(): return uuid.uuid4().hex
mode=sys.argv[2] if len(sys.argv)>2 else "direct"
assert mode in ("direct","resumable","dual","url")
trace=Path("evidence/media-"+mode+"-http.jsonl")
trace.write_text("")
def record(method,path,token,expected,status,raw,transport=None):
    entry={"method":method,"path":path,"actor":"owner" if token==a else "foreign",
           "expected":expected,"status":status}
    if raw is not None:
        entry.update(bodyBytes=len(raw),bodySha256=hashlib.sha256(raw).hexdigest())
    if transport is not None:
        entry["transport"]=transport
    with trace.open("a") as stream:stream.write(json.dumps(entry)+"\n")
    print(method,path,entry["actor"],"expected",expected,"actual",status,flush=True)
def call(method,path,token=a,data=None,idem=None,expected=200,raw=None,binary=False,extra=None):
    headers={"Authorization":"Bearer "+token,"Connection":"close"}
    if idem: headers["Idempotency-Key"]=idem
    if data is not None: headers["Content-Type"]="application/json"
    if raw is not None: headers["Content-Type"]="application/octet-stream"
    if extra: headers.update(extra)
    try:
        if raw is not None:
            status,payload=binary_request(base+path,method,headers,raw)
        else:
            req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
            for attempt in range(8):
                try:
                    with urllib.request.urlopen(req,timeout=240) as res: status,payload=res.status,res.read()
                    break
                except urllib.error.HTTPError as exc:
                    status,payload=exc.code,exc.read()
                    break
                except (urllib.error.URLError,ConnectionError,http.client.RemoteDisconnected):
                    if method!="GET" or attempt==7:raise
                    time.sleep(2)
    except Exception as exc:
        record(method,path,token,expected,None,raw,type(exc).__name__)
        raise
    record(method,path,token,expected,status,raw)
    assert status==expected,(method,path,status,payload[:500])
    return payload if binary else json.loads(payload)
disk=Path(sys.argv[1]).read_bytes()
assert 512<=len(disk)<=64*1024*1024
fmt="qcow2" if disk.startswith(b"QFI\xfb") else "raw"
digest=hashlib.sha256(disk).hexdigest()
spec=dict(version=1,name="ci-upload",architecture="amd64",cpu=1,memoryMiB=512,image="uploaded-disk",storage={"systemGiB":2,"exchangeGiB":1},media={"format":fmt,"bytes":len(disk),"sha256":digest,"source":"quay.io/kubevirt/cirros-container-disk-demo@sha256:0e5ac38b20abcc7752293425b239a147868facd62cd5030dede6da6f2fc526a1","os":"CirrOS","version":"pinned-test-digest","authorizedByClient":True},firmware="bios")
if mode=="url":
    assert digest=="7d6355852aeb6dbcd191bcda7cd74f1536cfe5cbf8a10495a7283a8396e4b75b" and len(disk)==21692416
    spec["media"]["source"]="https://download.cirros-cloud.net/0.6.3/cirros-0.6.3-x86_64-disk.img"
    spec["media"]["version"]="0.6.3"
if mode=="dual":
    aux=b"VM-interface-secondary-disk"+bytes(4096)
    auxsha=hashlib.sha256(aux).hexdigest()
    spec["auxiliaryDisk"]={"sizeGiB":1,"media":{"format":"raw","bytes":len(aux),"sha256":auxsha,"source":"CI-generated non-boot secondary disk","os":"fixture","version":"1","authorizedByClient":True}}
artifact=None
if mode=="url":
    declaration={"metadata":spec["media"],"architecture":"amd64","licensing":"CirrOS project published free test image; client authorized"}
    k=key()
    registration=call("POST","/media-artifacts",data=declaration,idem=k,expected=202)
    assert call("POST","/media-artifacts",data=declaration,idem=k,expected=202)==registration
    artifact=registration["result"]["id"]
    ap="/media-artifacts/"+artifact
    assert call("GET",ap)["state"]=="registered"
    assert call("GET","/media-artifacts",token=b)["artifacts"]==[]
    call("GET",ap,token=b,expected=404)
    call("PUT",ap+"/file",token=b,raw=disk,idem=key(),expected=404)
    call("PUT",ap+"/file",raw=bytes([disk[0]^1])+disk[1:],idem=key(),expected=422)
    assert call("GET",ap)["state"]=="registered"
    k=key()
    uploaded=call("PUT",ap+"/file",raw=disk,idem=k,expected=202)
    assert uploaded["result"]["state"]=="verified"
    assert call("PUT",ap+"/file",raw=disk,idem=k,expected=202)==uploaded
    call("PUT",ap+"/file",raw=disk,idem=key(),expected=409)
    call("DELETE",ap,token=b,idem=key(),expected=404)
call("POST","/computers/plan",data=spec)
created=call("POST","/computers",data=spec,idem=key(),expected=202)
path="/computers/"+created["result"]["id"]
media=path+"/media"
try:
    call("POST",path+"/start",data={},idem=key(),expected=409)
    call("GET",media,token=b,expected=404)
    call("PUT",media+"/boot",token=b,raw=disk,idem=key(),expected=404)
    deadline=time.monotonic()+300
    while time.monotonic()<deadline:
        if call("GET",media)["phase"]=="UploadReady": break
        time.sleep(3)
    else: raise AssertionError("CDI did not reach UploadReady")
    if mode=="url":
        call("POST",media+"/boot/artifact",token=b,data={"artifactId":artifact},idem=key(),expected=404)
        k=key()
        first=call("POST",media+"/boot/artifact",data={"artifactId":artifact},idem=k,expected=202)
        assert first["result"]["sha256"]==digest
        assert call("POST",media+"/boot/artifact",data={"artifactId":artifact},idem=k,expected=202)==first
    elif mode in ("direct","dual"):
        bad=bytes([disk[0]^1])+disk[1:]
        call("PUT",media+"/boot",raw=bad,idem=key(),expected=422)
        assert not call("GET",media)["ready"]
        k=key()
        first=call("PUT",media+"/boot",raw=disk,idem=k,expected=202)
        assert first["result"]["sha256"]==digest
        assert call("PUT",media+"/boot",raw=disk,idem=k,expected=202)==first
    else:
        chunk=call("GET",media)["chunkBytes"]
        assert chunk==8*1024*1024
        endpoint=media+"/boot/chunks"
        def send(offset,blob,idem=None,expected=202,token=a,sha=None):
            return call("PUT",endpoint,token=token,raw=blob,idem=idem or key(),expected=expected,extra={"Upload-Offset":str(offset),"X-Content-SHA256":sha or hashlib.sha256(blob).hexdigest()})
        first_chunk=disk[:chunk]
        call("POST",media+"/boot/commit",idem=key(),expected=409)
        send(0,first_chunk,token=b,expected=404)
        send(0,first_chunk,sha="0"*64,expected=422)
        if len(disk)>chunk:
            send(chunk,disk[chunk:2*chunk],expected=409)
        k=key()
        first=send(0,first_chunk,idem=k)
        assert first["result"]["received"]==len(first_chunk)
        assert send(0,first_chunk,idem=k)==first
        assert send(0,first_chunk)["result"]["replayed"] is True
        changed=bytes([first_chunk[0]^1])+first_chunk[1:]
        send(0,changed,expected=409)
        assert call("GET",media)["stagedBytes"]==len(first_chunk)
        # Explicit discard must not touch CDI disks, and resume begins again.
        assert call("DELETE",endpoint,idem=key(),expected=202)["result"]["discarded"] is True
        assert call("GET",media)["stagedBytes"]==0
        for offset in range(0,len(disk),chunk):
            result=send(offset,disk[offset:offset+chunk])
            assert result["result"]["received"]==min(offset+chunk,len(disk))
        assert call("GET",media)["stagedBytes"]==len(disk)
        k=key()
        first=call("POST",media+"/boot/commit",idem=k,expected=202)
        assert first["result"]["sha256"]==digest
        assert call("POST",media+"/boot/commit",idem=k,expected=202)==first
    deadline=time.monotonic()+300
    while time.monotonic()<deadline:
        state=call("GET",media)
        if state["ready"]: break
        time.sleep(3)
    else: raise AssertionError("Verified CDI import did not converge")
    if mode=="dual":
        call("POST",path+"/start",data={},idem=key(),expected=409)
        call("GET",media+"/auxiliary",token=b,expected=404)
        deadline=time.monotonic()+300
        while time.monotonic()<deadline:
            if call("GET",media+"/auxiliary")["phase"]=="UploadReady":break
            time.sleep(3)
        else:raise AssertionError("Auxiliary not UploadReady")
        call("PUT",media+"/auxiliary",raw=aux,idem=key(),expected=202)
        deadline=time.monotonic()+300
        while time.monotonic()<deadline:
            if call("GET",media+"/auxiliary")["ready"]:break
            time.sleep(3)
        else:raise AssertionError("Auxiliary import incomplete")
        assert call("GET",media)["ready"]
        assert call("GET",media+"/auxiliary")["metadata"]["sha256"]==auxsha
        disks=call("GET",path+"/storage")["volumes"]
        assert {d["kind"] for d in disks}=={"boot","exchange","auxiliary"}
    call("POST",path+"/start",data={},idem=key(),expected=202)
    deadline=time.monotonic()+420
    while time.monotonic()<deadline:
        if (call("GET",path).get("instance") or {}).get("status",{}).get("phase")=="Running":break
        time.sleep(3)
    else: raise AssertionError("Imported VM did not run")
    # Running VMI and a valid PNG are not a guest boot proof.
    screen_path=Path("evidence/imported-disk-"+mode+"-display.png")
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        png=call("GET",path+"/screenshot",binary=True)
        assert png.startswith(b"\x89PNG\r\n\x1a\n") and len(png)>100
        screen_path.write_bytes(png)
        if "cirroslogin" in ocr(screen_path):break
        time.sleep(3)
    else:raise AssertionError("Imported disk did not reach visible CirrOS login")
    report={"scope":"real-api-upload","mode":mode,"format":fmt,"bytes":len(disk),"sha256":digest,"verifiedCDI":True,"badDigestDenied":True,"crossAccountDenied":True,"idempotent":True,"screenshotSha256":hashlib.sha256(png).hexdigest(),"guestLoginVerified":True,
            "commit":os.environ["GITHUB_SHA"],"runId":os.environ["GITHUB_RUN_ID"]}
    if artifact:
        # Reuse the exact account artifact into another independent VM while
        # retaining the original PVC. Compare actual bound claim identities.
        original=next(v for v in call("GET",path+"/storage")["volumes"] if v["kind"]=="boot")["pvcUid"]
        assert original
        second=call("POST","/computers",data={**spec,"name":"ci-artifact-copy"},idem=key(),expected=202)
        other="/computers/"+second["result"]["id"]
        try:
            deadline=time.monotonic()+300
            while time.monotonic()<deadline:
                if call("GET",other+"/media")["phase"]=="UploadReady":break
                time.sleep(3)
            else:raise AssertionError("Second CDI artifact target not ready")
            call("POST",other+"/media/boot/artifact",data={"artifactId":artifact},idem=key(),expected=202)
            deadline=time.monotonic()+300
            while time.monotonic()<deadline:
                if call("GET",other+"/media")["ready"]:break
                time.sleep(3)
            else:raise AssertionError("Registered artifact copy did not import")
            copy=next(v for v in call("GET",other+"/storage")["volumes"] if v["kind"]=="boot")["pvcUid"]
            assert copy and copy!=original
            call("DELETE",ap,idem=key(),expected=202)
            call("GET",ap,expected=404)
            assert call("GET",path+"/media")["ready"] and call("GET",other+"/media")["ready"]
            assert call("GET","/media-artifacts")["usage"]=={"count":0,"bytes":0}
            Path("evidence/registered-artifact-verification.json").write_text(json.dumps({"artifactId":artifact,"sha256":digest,"bytes":len(disk),"sourcePvcUid":original,"copyPvcUid":copy,"crossAccountDenied":True,"badDigestDenied":True,"immutable":True,"deletedArtifactIndependentDisks":True},indent=2))
            artifact=None
        finally:
            call("DELETE",other+"?deleteDisks=true",idem=key(),expected=202)
    print("Actual authorized disk bytes uploaded through API, verified by CDI and boot display captured")
finally:
    call("DELETE",path+"?deleteDisks=true",idem=key(),expected=202)
    if artifact:call("DELETE","/media-artifacts/"+artifact,idem=key(),expected=202)

# Publish completed evidence only after cleanup succeeds. Partial traces/screens
# remain available on failure and are not represented as a pass.
report["traceSha256"]=hashlib.sha256(trace.read_bytes()).hexdigest()
Path("evidence/media-"+mode+"-verification.json").write_text(json.dumps(report,indent=2))
