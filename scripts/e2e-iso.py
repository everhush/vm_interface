"""API-only installer CD-ROM proof. GRUB boot marker, not OS installation."""
import hashlib,json,os,re,subprocess,sys,time,urllib.request,urllib.error,uuid
from pathlib import Path
from iso_marker import read_marker
base=os.environ.get("API_URL","http://127.0.0.1:3000/api/v1")
a,b=os.environ["TOKEN_A"],os.environ["TOKEN_B"]
def key(): return uuid.uuid4().hex
def call(method,path,token=a,data=None,idem=None,expected=200,raw=None,binary=False):
    h={"Authorization":"Bearer "+token}
    if idem: h["Idempotency-Key"]=idem
    if data is not None: h["Content-Type"]="application/json"
    if raw is not None: h["Content-Type"]="application/octet-stream"
    req=urllib.request.Request(base+path,data=raw if raw is not None else json.dumps(data).encode() if data is not None else None,headers=h,method=method)
    try:
        with urllib.request.urlopen(req,timeout=240) as res: status,payload=res.status,res.read()
    except urllib.error.HTTPError as exc: status,payload=exc.code,exc.read()
    assert status==expected,(method,path,status,payload[:500])
    return payload if binary else json.loads(payload)
def wait(fn,timeout,reason):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if fn(): return
        time.sleep(3)
    raise AssertionError(reason)
disk=Path(sys.argv[1]).read_bytes()
assert 32768<len(disk)<=64*1024*1024,"Fixture must fit the bounded media profile"
digest=hashlib.sha256(disk).hexdigest()
results=[]
for firmware in ["bios","uefi"]:
    spec=dict(version=1,name="ci-iso-"+firmware,architecture="amd64",cpu=1,memoryMiB=768,image="uploaded-installer",storage={"systemGiB":2,"exchangeGiB":1},media={"format":"iso","bytes":len(disk),"sha256":digest,"source":"CI-generated GRUB fixture from distribution packages","os":"GRUB boot evidence only","version":"1","authorizedByClient":True},firmware=firmware)
    spec["auxiliaryDisk"]={"sizeGiB":1,"media":{**spec["media"],"os":"auxiliary read-only fixture"}}
    call("POST","/computers/plan",data=spec)
    created=call("POST","/computers",data=spec,idem=key(),expected=202)
    path="/computers/"+created["result"]["id"]
    media=path+"/media"
    pngfile=Path("evidence/iso-"+firmware+"-display.png")
    try:
        call("POST",path+"/start",data={},idem=key(),expected=409)
        call("GET",media,token=b,expected=404)
        wait(lambda:call("GET",media)["phase"]=="UploadReady",300,"ISO not upload ready")
        first=call("PUT",media+"/installer",raw=disk,idem=key(),expected=202)
        assert first["result"]["sha256"]==digest
        wait(lambda:call("GET",media)["ready"],300,"ISO import not verified")
        call("POST",path+"/start",data={},idem=key(),expected=409)
        wait(lambda:call("GET",media+"/auxiliary")["phase"]=="UploadReady",300,"Driver ISO not upload ready")
        assert call("PUT",media+"/auxiliary",raw=disk,idem=key(),expected=202)["result"]["sha256"]==digest
        wait(lambda:call("GET",media+"/auxiliary")["ready"],300,"Driver ISO not verified")
        call("POST",path+"/start",data={},idem=key(),expected=202)
        wait(lambda:(call("GET",path).get("instance") or {}).get("status",{}).get("phase")=="Running",420,"Installer VM did not run")
        def marker():
            try: png=call("GET",path+"/screenshot",binary=True)
            except AssertionError: return False
            assert png.startswith(b"\x89PNG\r\n\x1a\n")
            pngfile.write_bytes(png)
            verified, text=read_marker(pngfile)
            pngfile.with_suffix(".ocr.txt").write_text(text)
            return verified
        wait(marker,180,"No installer boot marker in actual API screenshots")
        results.append({"firmware":firmware,"bytes":len(disk),"sha256":digest,"guestVisibleBootMarker":True,"screenshotSha256":hashlib.sha256(pngfile.read_bytes()).hexdigest(),"osInstallationVerified":False})
        print(f"Actual {firmware} installer CD-ROM boot marker visible through API")
        call("POST",path+"/stop",data={},idem=key(),expected=202)
        wait(lambda:call("GET",path)["instance"] is None,240,"Stop did not converge")
        wait(lambda:(v:=call("GET",path))["instance"] is None and v["desired"]["runStrategy"]=="Halted" and not any((v.get("status") or {}).get(k) for k in ("created","ready","stateChangeRequests")),120,"VM not fully halted")
        current=call("GET",path)
        change={"first":"system","installerTray":"open","expectedResourceVersion":current["resourceVersion"]}
        planned=call("POST",path+"/boot/plan",data=change)
        assert planned["installerTray"]=="open"
        assert call("GET",path)["resourceVersion"]==current["resourceVersion"]
        call("PATCH",path+"/boot",data=change,idem=key(),expected=202)
        current=call("GET",path)
        disks=current["desired"]["template"]["spec"]["domain"]["devices"]["disks"]
        assert next(d for d in disks if d["name"]=="installer")["cdrom"]["tray"]=="open"
        driver=next(d for d in disks if d["name"]=="auxiliary")
        assert driver["cdrom"]["readonly"] is True and "bootOrder" not in driver
        call("PATCH",path+"/boot",data={"first":"installer","expectedResourceVersion":current["resourceVersion"]},idem=key(),expected=422)
        call("PATCH",path+"/boot",data={"first":"installer","installerTray":"closed","expectedResourceVersion":current["resourceVersion"]},idem=key(),expected=202)
        call("POST",path+"/start",data={},idem=key(),expected=202)
        wait(lambda:(call("GET",path).get("instance") or {}).get("status",{}).get("phase")=="Running",420,"Reinserted installer VM did not run")
        wait(marker,180,"Reinserted installer boot not visible")
        results[-1]["coldTrayDesiredStateAndReinsertBootVerified"]=True
    finally:
        call("DELETE",path+"?deleteDisks=true",idem=key(),expected=202)
Path("evidence/iso-boot-verification.json").write_text(json.dumps({"scope":"real-api-CDROM-boot-only","results":results},indent=2))
