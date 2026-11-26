"""External API client for authorized Windows x64 and native Android ARM64.
No Kubernetes/hypervisor access. Device-specific installation UI checkpoints
are client-owned JSON, not backend workflows. Fail closed on missing evidence.
"""
import argparse, hashlib, json, os, re, runpy, secrets, subprocess, time, uuid, zipfile
from pathlib import Path
from showcase_inputs import load_scenario
from android_fixture import ANDROID_RESULT_MODE,android_result
from screen_targets import locate_label
from android_guest_transfer import AndroidGuestTransfer, verify_staged_bundle

P = argparse.ArgumentParser()
P.add_argument("profile", choices=["windows", "android"])
P.add_argument("--media", type=Path, required=True)
P.add_argument("--media-sha256", required=True)
P.add_argument("--auxiliary-media", type=Path)
P.add_argument("--auxiliary-sha256")
P.add_argument("--auxiliary-gib", type=int)
P.add_argument("--source", required=True)
P.add_argument("--version", required=True)
P.add_argument("--software", type=Path, required=True)
P.add_argument("--software-sha256", required=True)
P.add_argument("--scenario", type=Path, required=True,
               help="Client-owned screen/input steps for exact media version")
P.add_argument("--system-gib", type=int, default=40)
P.add_argument("--authorize-media", action="store_true", required=True)
P.add_argument("--record-consent", action="store_true", required=True)
P.add_argument("--retain", action="store_true")
P.add_argument("--exchange-drive", default="X:", help="Windows mounted guest exchange drive")
P.add_argument("--preflight-only", action="store_true", help="Validate local inputs without provisioning or API credentials")
P.add_argument("--android-transfer", choices=["virtiofs-saf","adb-saf"], default="virtiofs-saf")
P.add_argument("--authorize-android-debug", action="store_true")
args = P.parse_args()
adb_mode=args.android_transfer=="adb-saf"
if adb_mode != args.authorize_android_debug or (adb_mode and args.profile!="android"):
    P.error("Explicit Android-only authenticated debug authorization is required for adb-saf")
def sha(data):
    return hashlib.sha256(data).hexdigest()
def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()
def verify_local(path, expected, limit):
    assert path.is_file() and 0 < path.stat().st_size <= limit
    assert re.fullmatch("[a-f0-9]{64}", expected) and digest(path) == expected, "Local media checksum mismatch"
def norm(s):
    return re.sub("[^a-z0-9]", "", s.lower())
def iid():
    return str(uuid.uuid4())

scenario = load_scenario(args.scenario, args.profile)
assert set(scenario) == {"setup", "softwareSetup", "application", "beforeMarker", "afterMarker", "resultName", "expectedResultSha256"}
assert isinstance(scenario["setup"], list) and isinstance(scenario["application"], list)
assert norm(scenario["beforeMarker"]) and norm(scenario["afterMarker"]) and norm(scenario["beforeMarker"]) != norm(scenario["afterMarker"])
assert re.fullmatch("[A-Za-z0-9][A-Za-z0-9._-]{0,95}", scenario["resultName"])
assert (re.fullmatch("[a-f0-9]{64}", scenario["expectedResultSha256"]) if args.profile=="windows" else scenario["expectedResultSha256"]==ANDROID_RESULT_MODE)
# Credentials, activation, and licensing prompts are exclusively handled by
# the authorized human in setup. Never screenshot or record that checkpoint.
if args.profile == "windows":
    assert args.media.suffix.lower() == ".iso" and args.software.suffix.lower() == ".exe"
    assert args.system_gib >= 32 and re.fullmatch("[A-Za-z]:",args.exchange_drive)
    assert scenario["resultName"]=="result.txt"
    assert scenario["expectedResultSha256"]==sha(b"VM Interface Windows 7-Zip functional proof\n")
    assert "7zip" in norm(scenario["afterMarker"]) or "proof7z" in norm(scenario["afterMarker"])
else:
    assert args.media.suffix.lower() in (".raw",".img",".qcow2") and args.software.suffix.lower() == ".apk"
    with zipfile.ZipFile(args.software) as apk:
        assert "AndroidManifest.xml" in apk.namelist() and "classes.dex" in apk.namelist()
    assert "apkcompletearm64v8a" in norm(scenario["afterMarker"]), "Require actual APK completion and ARM64 ABI on screen"
    assert scenario["resultName"]=="result.txt"
    assert scenario["expectedResultSha256"]==ANDROID_RESULT_MODE
verify_local(args.media,args.media_sha256,8*1024**3)
verify_local(args.software,args.software_sha256,8*1024**2)
if args.auxiliary_media:
    assert args.auxiliary_media.suffix.lower()==(".iso" if args.profile=="windows" else ".qcow2") and args.auxiliary_gib and 1<=args.auxiliary_gib<=64
    verify_local(args.auxiliary_media,args.auxiliary_sha256,8*1024**3)
else:
    assert args.auxiliary_sha256 is None and args.auxiliary_gib is None
    assert args.profile!="windows", "Windows driver bootstrap requires a separately verified auxiliary ISO"

if args.preflight_only:
    print(json.dumps({"profile":args.profile,"localInputsVerified":True,"guestCompatibilityVerified":False,"transferPath":args.android_transfer,"mediaSha256":args.media_sha256,"softwareSha256":args.software_sha256,"scenarioSha256":digest(args.scenario)}))
    raise SystemExit(0)
os.environ["PROOF_OUTPUT_DIR"] = "evidence/showcase-" + args.profile
h = runpy.run_path(str(Path(__file__).with_name("e2e-api-control-proof.py")), run_name="proof_helpers")
call, wait, screen, batch, sha = (h[x] for x in ("call","wait","screen","batch","sha"))
OUT, A, B = h["OUT"], h["A"], h["B"]
path = rec = key_id = ticket = guest_transfer = None
lease = False
ticket_expiry = 0
ticket_id = None
def get_ticket():
    global ticket, ticket_expiry, lease, ticket_id
    if ticket and time.monotonic() < ticket_expiry:
        return
    if ticket and lease:
        try: call("DELETE",path+"/input-lease",ticket,scheme="Console")
        except AssertionError: pass
    if ticket_id:
        call("DELETE",path+"/console-tickets/"+ticket_id)
    grant=call("POST",path+"/console-tickets",key_secret,{"scope":"control-vnc"},expected=201,phase="control ticket")
    assert grant["actor"]=="automation"
    ticket=grant["token"]
    ticket_id=grant["id"]
    ticket_expiry=time.monotonic()+95
    lease=False
def send(events):
    global lease
    assert 1 <= len(events) <= 64
    get_ticket()
    claim=call("POST",path+"/input-lease",ticket,{},scheme="Console")
    lease=True
    assert claim["active"] and claim["actor"]=="automation"
    result=call("POST",path+"/input",ticket,{"events":events},expected=202,scheme="Console",phase="guest action")
    assert result["result"]["accepted"]==len(events)
def release():
    global lease
    if ticket and lease:
        if time.monotonic()<ticket_expiry:
            call("DELETE",path+"/input-lease",ticket,scheme="Console")
        lease=False
def refresh_key():
    global key_id,key_secret,ticket,lease,ticket_expiry,ticket_id
    release()
    if key_id: call("DELETE","/keys/"+key_id)
    k=call("POST","/keys",body={"label":"native-showcase","permission":"manage","ttlSeconds":3600},expected=201)
    key_id,key_secret=k["id"],k["token"]
    if ticket_id:call("DELETE",path+"/console-tickets/"+ticket_id)
    ticket,lease,ticket_expiry,ticket_id=None,False,0,None
def visible(text, label, seconds):
    assert isinstance(text,str) and 1<=len(norm(text))<=100
    wait(lambda:norm(text) in screen(path,OUT/(label+".png"))[0],seconds,"Expected guest display not reached")
def steps(items, recording=False):
    assert len(items)<=100
    for i,s in enumerate(items):
        assert isinstance(s,dict) and len(s)==1
        kind,value=next(iter(s.items()))
        if kind=="wait":
            assert set(value)=={"text","seconds"} and 1<=value["seconds"]<=900
            visible(value["text"],("recorded" if recording else "setup")+f"-{i:03d}",value["seconds"])
        elif kind=="delay":
            assert isinstance(value,int) and 0<=value<=60
            time.sleep(value)
        elif kind=="text":
            assert isinstance(value,str) and 0<len(value)<=4096 and all(32<=ord(c)<=126 for c in value)
            for j in range(0,len(value),24):send(batch(value[j:j+24])["events"])
        elif kind=="keys":
            assert isinstance(value,list) and 1<=len(value)<=8 and all(isinstance(k,int) and 0<=k<=0x1fffffff for k in value)
            send([{"type":"key","keysym":k,"down":True} for k in value]+[{"type":"key","keysym":k,"down":False} for k in reversed(value)])
        elif kind=="click-label":
            def target():
                image=OUT/(("recorded" if recording else "setup")+f"-target-{i:03d}.png")
                data,headers=call("GET",path+"/screenshot",binary=True)
                assert headers.get("Content-Type")=="image/png"
                image.write_bytes(data)
                return locate_label(image,value["text"])
            x,y=wait(target,value["seconds"],"Unique guest button not found")
            send([{"type":"pointer","x":x,"y":y,"buttons":v} for v in (0,1,0)])
        elif kind=="click":
            assert isinstance(value,list) and len(value)==2 and 0<=value[0]<1920 and 0<=value[1]<1200
            x,y=value
            send([{"type":"pointer","x":x,"y":y,"buttons":v} for v in (0,1,0)])
        elif kind=="human":
            assert not recording, "No recording during credentials/license interaction"
            release()
            print("Authorized human checkpoint:", str(value)[:160], flush=True)
            print("Use an account control-vnc ticket and release it before continuing.")
            input("Press Enter when complete (never enter credentials here): ")
            refresh_key()
        elif kind=="system-boot":
            assert not recording and args.profile=="windows" and value is True
            release()
            call("POST",path+"/stop",body={},expected=202)
            wait(lambda:call("GET",path)["instance"] is None,300,"Stop did not converge")
            v=call("GET",path)
            spec={"first":"system","installerTray":"open","expectedResourceVersion":v["resourceVersion"]}
            call("POST",path+"/boot/plan",body=spec)
            call("PATCH",path+"/boot",body=spec,expected=202)
            call("POST",path+"/start",body={},expected=202)
            wait(lambda:(call("GET",path).get("instance") or {}).get("status",{}).get("phase")=="Running",420,"Installed VM failed to start")
            refresh_key()
        else:
            raise AssertionError("Unsupported scenario action: "+kind)

def running():
    instance=call("GET",path).get("instance")
    return instance if instance and instance["status"]["phase"]=="Running" else None

def identities():
    volumes=call("GET",path+"/storage")["volumes"]
    if not volumes or not all(v["pvcPhase"]=="Bound" and v["pvcUid"] for v in volumes):return None
    return {v.get("diskName") or v["kind"]:v["pvcUid"] for v in volumes}

def upload_android():
    for name,data,phase in [("proof.apk",software,"upload file"),("challenge.bin",challenge,"upload challenge")]:
        response=call("PUT",path+"/files/"+name,raw=data,expected=202,extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":sha(data)},phase=phase)
        assert response["result"]["sha256"]==sha(data)
    (OUT/"challenge.bin").write_bytes(challenge)
    (OUT/"proof.apk").write_bytes(software)
    (OUT/"scenario.json").write_bytes(args.scenario.read_bytes())

try:
    win=args.profile=="windows"
    fmt="iso" if win else ("qcow2" if args.media.suffix.lower()==".qcow2" else "raw")
    spec={"version":1,"name":"showcase-"+args.profile,"architecture":"amd64" if win else "arm64",
          "cpu":2,"memoryMiB":4096,"image":"uploaded-installer" if win else "uploaded-disk",
          "firmware":"uefi","bootBus":"sata" if win else "virtio",
          "storage":{"systemGiB":args.system_gib,"exchangeGiB":1,"exchangeMode":"virtiofs",**({} if win else {"exchangeTag":"share"})},
          "media":{"format":fmt,"bytes":args.media.stat().st_size,"sha256":args.media_sha256,
                   "source":args.source,"os":"Windows Server 2022" if win else "Android",
                   "version":args.version,"authorizedByClient":True}}
    if adb_mode:spec["network"]="private"
    if args.auxiliary_media:
        spec["auxiliaryDisk"]={"sizeGiB":args.auxiliary_gib,"media":{**spec["media"],"format":"iso" if win else "qcow2","bytes":args.auxiliary_media.stat().st_size,"sha256":args.auxiliary_sha256}}
    call("POST","/computers/plan",body=spec)
    created=call("POST","/computers",body=spec,expected=202,phase="create")
    path="/computers/"+created["result"]["id"]
    call("GET",path,B,expected=404)
    call("POST",path+"/start",body={},expected=409)
    def import_slot(slot, local_file):
        endpoint=path+"/media/"+slot
        state=wait(lambda:(s if (s:=call("GET",endpoint))["phase"]=="UploadReady" else None),600,"CDI target unavailable")
        chunk=state["chunkBytes"]; total=local_file.stat().st_size
        with local_file.open("rb") as data:
            offset=state["stagedBytes"];data.seek(offset)
            while offset<total:
                payload=data.read(chunk)
                result=call("PUT",endpoint+"/chunks",raw=payload,expected=202,
                            extra_headers={"Content-Type":"application/octet-stream","Upload-Offset":str(offset),"X-Content-SHA256":sha(payload)})
                offset+=len(payload)
                assert result["result"]["received"]==offset
        call("POST",endpoint+"/commit",expected=202,timeout=1900)
        wait(lambda:call("GET",endpoint)["ready"],1200,"Verified import not ready")
    import_slot("installer" if win else "boot",args.media)
    if args.auxiliary_media:
        call("POST",path+"/start",body={},expected=409)
        import_slot("auxiliary",args.auxiliary_media)
    software=args.software.read_bytes()
    if not win:
        challenge=secrets.token_bytes(4096)
        challenge_digest=sha(challenge)
    if adb_mode:
        upload_android()
        raw_bundle,headers=call("GET",path+"/exchange-bundle",binary=True,phase="staged bundle")
        assert headers.get("X-Content-SHA256")==sha(raw_bundle)
        call("GET",path+"/exchange-bundle",B,expected=404,binary=True)
        staged=verify_staged_bundle(raw_bundle,{"proof.apk":software,"challenge.bin":challenge})
        (OUT/"staged-exchange.tar").write_bytes(raw_bundle)
        for name,data in staged.items():(OUT/("staged-"+name)).write_bytes(data)
    if win:
        challenge=secrets.token_bytes(64)
        challenge_sha=sha(challenge)
        call("PUT",path+"/files/driver-challenge.bin",raw=challenge,expected=202,extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":challenge_sha})
    call("POST",path+"/start",body={},expected=202,phase="start")
    instance=wait(running,600,"VM not Running")
    original=wait(identities,120,"Persistent storage not bound")
    refresh_key()
    steps(scenario["setup"])
    if win:
        # Setup must end at an authorized elevated PowerShell prompt. The
        # bootstrap ISO is accessible via the inbox SATA CD-ROM driver.
        steps([{"text":"$d=(Get-Volume | Where-Object FileSystemLabel -eq 'VMDRIVERS').DriveLetter; if (@($d).Count -ne 1) { throw 'Missing driver media' }; & ($d+':\\bootstrap.ps1') -Drive '"+args.exchange_drive+"' -ChallengeSha256 '"+challenge_sha+"'"},{"keys":[0xff0d]},{"wait":{"text":"VMDRIVERSREADY","seconds":180}}])
    # Setup must establish OS installation, guest exchange mount and desktop
    # readiness before recording. Device-specific steps are not fabricated.
    if win:
        upload=call("PUT",path+"/files/software.exe",raw=software,expected=202,
                    extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":sha(software)},phase="upload file")
        assert upload["result"]["sha256"]==args.software_sha256
        fixture=(Path(__file__).resolve().parents[1]/"showcases/windows/proof.ps1").read_bytes()
        call("PUT",path+"/files/proof.ps1",raw=fixture,expected=202,extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":sha(fixture)})
    elif adb_mode:
        guest_transfer=AndroidGuestTransfer(call,wait,path,B,OUT)
        guest_transfer.authorize(lambda:steps([{"human":"Approve only the newly displayed RSA debugging key in the guest. Never enable unauthenticated debugging."}]))
        guest_transfer.install(OUT/"staged-proof.apk",OUT/"staged-challenge.bin")
    else:
        upload_android()
    # Install/authorize uploaded software only after the bytes exist in the exchange.
    steps(scenario["softwareSetup"])
    visible(scenario["beforeMarker"],"before",120)
    if adb_mode:guest_transfer.absent()
    else:assert not any(f["name"]==scenario["resultName"] for f in call("GET",path+"/files")), "Stale result"
    uid=wait(running,120,"Guest not running")["metadata"]["uid"]
    # Never record login/MFA or installation licensing screens.
    start=call("POST",path+"/recordings",body={"consent":True,"maxSeconds":120},expected=202,phase="record start")
    rec=path+"/recordings/"+start["result"]["id"]
    wait(lambda:call("GET",rec)["status"]=="recording",20,"Recording not active")
    time.sleep(4)
    if win:
        # Setup places the authorized desktop at an interactive PowerShell prompt.
        command="& "+args.exchange_drive+"\\in-proof.ps1 -Exchange "+args.exchange_drive+"\\"
        steps([{"text":command},{"keys":[0xff0d]}],recording=True)
    steps(scenario["application"],recording=True)
    visible(scenario["afterMarker"],"after",45)
    if adb_mode:
        result=guest_transfer.result()
        assert result==android_result(challenge)
    else:
        wait(lambda:any(f["name"]==scenario["resultName"] for f in call("GET",path+"/files")),20,"Guest output not published")
        result,headers=call("GET",path+"/files/"+scenario["resultName"],binary=True,phase="download file")
        assert sha(result)==headers.get("X-Content-SHA256")
        if win:assert sha(result)==scenario["expectedResultSha256"]
        else:assert result==android_result(challenge)
        call("GET",path+"/files/"+scenario["resultName"],B,expected=404,binary=True)
    (OUT/"guest-result.bin").write_bytes(result)
    time.sleep(4);release()
    call("POST",rec+"/stop",body={},expected=202,phase="record stop")
    def complete():
        s=call("GET",rec);assert s["status"]!="failed"
        return s if s["status"]=="completed" else None
    meta=wait(complete,120,"Recording incomplete")
    video,headers=call("GET",rec+"/file",binary=True,phase="retrieve MP4")
    assert meta["instanceUid"]==uid and sha(video)==meta["sha256"] and len(video)==meta["bytes"] and headers.get("Content-Type")=="video/mp4"
    raw=OUT/"platform-recording.mp4";raw.write_bytes(video)
    decoded=h["check_video"](raw,norm(scenario["beforeMarker"]),norm(scenario["afterMarker"]))
    call("GET",rec+"/file",B,expected=404,binary=True)
    call("DELETE",rec,expected=202);rec=None
    if guest_transfer:guest_transfer.disconnect()
    call("POST",path+"/stop",body={},expected=202,phase="stop")
    wait(lambda:call("GET",path)["instance"] is None,300,"Stop failed")
    h["cold_resize"](path,3,4096)
    call("POST",path+"/start",body={},expected=202,phase="restart after resize")
    resized=wait(running,600,"Resize restart failed")
    new_uid=resized["metadata"]["uid"]
    domain=resized["spec"]["domain"]
    assert new_uid!=uid and domain["cpu"]["cores"]==3 and domain["memory"]["guest"] in ("4096Mi","4Gi")
    after=wait(identities,120,"Storage not bound after resize")
    assert original==after
    if adb_mode:
        guest_transfer.ensure(lambda:steps([{"human":"If the guest requests authorization after restart, approve only the same test RSA debugging key. Keep SELinux enforcing and ADB authentication enabled."}]))
        again=guest_transfer.result()
        guest_transfer.report["rebootOutputSha256"]=sha(again)
        guest_transfer.report["stagedBundleSha256"]=sha(raw_bundle)
        (OUT/"android-adb.json").write_text(json.dumps(guest_transfer.report,indent=2)+"\n")
        guest_transfer.close();guest_transfer=None
    else:
        again,_=call("GET",path+"/files/"+scenario["resultName"],binary=True)
    assert again==result
    call("POST",path+"/stop",body={},expected=202)
    wait(lambda:call("GET",path)["instance"] is None,300,"Final stop failed")
    if not args.retain:
        call("DELETE",path,expected=409)
        call("DELETE",path+"?deleteDisks=true",expected=202,phase="delete");path=None
    # Finish all API cleanup before sealing the trace digest.
    release()
    call("DELETE","/keys/"+key_id,phase="revoke controller key")
    key_id=None
    proof={"profile":args.profile,"vmId":created["result"]["id"],"architecture":spec["architecture"],
           "mediaSha256":args.media_sha256,"auxiliarySha256":args.auxiliary_sha256,"softwareSha256":args.software_sha256,"outputSha256":sha(result),
           "scenarioSha256":digest(args.scenario),"traceSha256":sha(h["TRACE"].read_bytes()),"runId":os.environ.get("GITHUB_RUN_ID"),"commit":os.environ.get("GITHUB_SHA"),"screenMarkersVerified":True,"recording":{**decoded,"sha256":meta["sha256"],"bytes":meta["bytes"]},
           "coldResizeAndFilePersistence":True,"instanceUid":uid,"resizedInstanceUid":new_uid,"originalPvcUids":original,"resizedPvcUids":after,"cpuAfterResize":domain["cpu"]["cores"],"retained":args.retain}
    if not win:proof.update({"challengeSha256":challenge_digest,"challengeBytes":len(challenge),"resultMode":ANDROID_RESULT_MODE})
    if not win:proof["transferPath"]="authorized-adb-over-private-tunnel" if adb_mode else "virtiofs-saf"
    if adb_mode:proof["guestTransferSha256"]=digest(OUT/"android-adb.json")
    proof["derivedPresentation"]=h["presentation"](raw,"REAL "+args.profile.upper()+" SHOWCASE")
    (OUT/"verification.json").write_text(json.dumps(proof,indent=2)+"\n")
finally:
    if guest_transfer:
        try:guest_transfer.close()
        except Exception:print("Guest transfer cleanup incomplete")
    for method,endpoint,token,scheme,body,expected in [
        ("DELETE",path+"/input-lease" if path and lease else None,ticket,"Console",None,200),
        ("POST",rec+"/stop" if rec else None,A,"Bearer",{},202),
        ("DELETE","/keys/"+key_id if key_id else None,A,"Bearer",None,200),
        ("DELETE",path+"?deleteDisks=true" if path and not args.retain else None,A,"Bearer",None,202)]:
        if endpoint and token:
            try:call(method,endpoint,token,body,expected,scheme)
            except Exception:print("Cleanup incomplete:",method,endpoint)
