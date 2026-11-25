import json, os, time, urllib.request, urllib.error, uuid, struct, zlib
base=os.environ.get("API_URL","http://127.0.0.1:3000/api/v1")
a,b=os.environ["TOKEN_A"],os.environ["TOKEN_B"]
def call(method,path,token=a,data=None,key=None,expected=200,scheme="Bearer"):
    headers={"Authorization":scheme+" "+token}
    if data is not None: headers["Content-Type"]="application/json"
    if key: headers["Idempotency-Key"]=key
    req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=30) as r: status,payload=r.status,json.load(r)
    except urllib.error.HTTPError as e: status,payload=e.code,json.load(e)
    assert status==expected,(method,path,status,payload)
    return payload
def key(): return uuid.uuid4().hex
def capture(path,token=a,expected=200,scheme="Bearer"):
    req=urllib.request.Request(base+path,headers={"Authorization":scheme+" "+token})
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            assert r.status==expected,(r.status,expected)
            assert r.headers.get_content_type()=="image/png"
            assert r.headers.get("Cache-Control")=="no-store"
            return r.read(8*1024*1024+1)
    except urllib.error.HTTPError as e:
        assert e.code==expected,(e.code,expected,e.read())
        return None
def verify_png(png):
    assert png[:8]==b"\x89PNG\r\n\x1a\n" and len(png)<=8*1024*1024
    pos=8; chunks=[]; width=height=0; ended=False
    while pos<len(png):
        assert pos+12<=len(png)
        size,kind=struct.unpack_from(">I4s",png,pos)
        assert pos+12+size<=len(png)
        data=png[pos+8:pos+8+size]
        assert zlib.crc32(kind+data)&0xffffffff==struct.unpack_from(">I",png,pos+8+size)[0]
        pos+=size+12
        if kind==b"IHDR": width,height=struct.unpack_from(">II",data)
        if kind==b"IDAT": chunks.append(data)
        if kind==b"IEND":
            ended=True
            assert size==0 and pos==len(png)
            break
    assert ended and 0<width<=8192 and 0<height<=8192 and chunks
    decoder=zlib.decompressobj()
    pixels=decoder.decompress(b"".join(chunks),128*1024*1024)
    assert decoder.eof and pixels and not decoder.unconsumed_tail
    return {"width":width,"height":height,"bytes":len(png)}

os.makedirs("evidence",exist_ok=True)
def record(label,state):
    # Only machine state/conditions from the application API, not auth or guest output.
    inst=state.get("instance") or {}
    vmstatus=state.get("status") or {}
    status=inst.get("status") or {}
    summary={"id":state.get("id"),"vmStatus":vmstatus.get("printableStatus"),
             "vmConditions":[{k:c.get(k) for k in ("type","status","reason")} for c in vmstatus.get("conditions",[])],
             "vmiUid":inst.get("metadata",{}).get("uid"),"vmiPhase":status.get("phase"),
             "vmiConditions":[{k:c.get(k) for k in ("type","status","reason")} for c in status.get("conditions",[])]}
    with open("evidence/api-lifecycle.jsonl","a") as f:
        f.write(json.dumps({"stage":label,"time":time.time(),**summary})+"\n")
    return summary
def wait_for(label,fn,seconds=360):
    end=time.monotonic()+seconds
    previous=None
    while time.monotonic()<end:
        state=call("GET","/computers/"+vm)
        summary=record(label,state)
        if summary!=previous:
            print(label,summary,flush=True)
            previous=summary
        if fn(state): return state
        time.sleep(5)
    raise AssertionError(label+" did not converge; last state: "+json.dumps(previous))
def running(state):
    return (state.get("instance") or {}).get("status",{}).get("phase")=="Running"
spec=dict(version=1,name="ci-smoke",architecture="amd64",cpu=1,memoryMiB=512,image="cirros-smoke")
call("GET","/schema",token="invalid",expected=401)
call("GET","/images",token="invalid",expected=401)
images=call("GET","/images")
assert len(images)==2 and images[0]["id"]=="cirros-smoke" and images[0]["architecture"]=="amd64"
assert images[0]["image"].endswith("@"+images[0]["digest"])
with open("evidence/image-catalog.json","w") as f: json.dump(images,f,indent=2)
schema=call("GET","/schema")
contract=call("GET","/openapi.json")
assert contract["openapi"]=="3.1.0"
assert contract["components"]["schemas"]["ComputerSpec"]=={k:v for k,v in schema.items() if k!="$schema"}
call("GET","/openapi.json",token="invalid",expected=401)
call("POST","/computers/plan",data={**spec,"hostPath":"/"},expected=422)
call("POST","/computers/plan",data={**spec,"architecture":"arm64"},expected=422)
call("POST","/computers/plan",data=spec)
advanced=dict(version=1,name=spec["name"],image=spec["image"],kubevirt={"architecture":"amd64","domain":{"cpu":{"cores":1},"resources":{"requests":{"memory":"512Mi"}}}})
assert call("POST","/computers/plan",data=advanced)["validated"]==spec
call("POST","/computers/plan",data={**advanced,"kubevirt":{**advanced["kubevirt"],"volumes":[{"hostDisk":{"path":"/"}}]}},expected=422)
call("GET","/schema/advanced")
call("POST","/computers",data=spec,expected=400)
# Desired reservations count halted VMs and are isolated by account.
assert call("GET","/account/quota")["usage"]==dict(computers=0,cpu=0,memoryMiB=0,storageGiB=0)
reserved=[]
try:
    large={**spec,"cpu":4,"memoryMiB":4096}
    for i in range(2):
        created=call("POST","/computers",data={**large,"name":"quota-"+str(i)},key=key(),expected=202)
        reserved.append(created["result"]["id"])
    usage=call("GET","/account/quota")["usage"]
    assert usage==dict(computers=2,cpu=8,memoryMiB=8192,storageGiB=0)
    assert call("GET","/account/quota",token=b)["usage"]["cpu"]==0
    call("POST","/computers/plan",data=spec,expected=409)
    rejected_key=key()
    rejected=call("POST","/computers",data=spec,key=rejected_key,expected=409)
    assert call("POST","/computers",data=spec,key=rejected_key,expected=409)==rejected
    with open("evidence/account-quota.json","w") as f: json.dump(usage,f,indent=2)
finally:
    for item in reserved: call("DELETE","/computers/"+item,key=key(),expected=202)
deadline=time.monotonic()+120
while time.monotonic()<deadline:
    if call("GET","/account/quota")["usage"]["computers"]==0: break
    time.sleep(3)
else: raise AssertionError("Quota reservations not released after VM deletion")
k=key()
created=call("POST","/computers",data=spec,key=k,expected=202)
vm=created["result"]["id"]
try:
    assert call("POST","/computers",data=spec,key=k,expected=202)==created
    assert call("POST","/computers",data=advanced,key=k,expected=202)==created
    call("POST","/computers",data={**spec,"cpu":2},key=k,expected=409)
    assert call("GET","/operations/"+created["operationId"])["status"]=="submitted"
    # Keys are account-scoped, never VM-specific; secrets appear only at issuance.
    issued=call("POST","/keys",data={"label":"ci-read","permission":"read","ttlSeconds":600},expected=201)
    read_key=issued["token"]
    assert call("GET","/computers/"+vm,token=read_key)["id"]==vm
    assert all("token" not in k and "tokenHash" not in k for k in call("GET","/keys"))
    assert all(k["id"]!=issued["id"] for k in call("GET","/keys",token=b))
    call("GET","/keys",token=read_key,expected=403)
    call("POST","/computers/"+vm+"/start",token=read_key,data={},key=key(),expected=403)
    call("DELETE","/keys/"+issued["id"],token=b,expected=404)
    rotated=call("POST","/keys/"+issued["id"]+"/rotate",expected=201)
    call("GET","/computers/"+vm,token=read_key,expected=401)
    assert call("GET","/computers/"+vm,token=rotated["token"])["id"]==vm
    call("DELETE","/keys/"+rotated["id"])
    call("GET","/computers/"+vm,token=rotated["token"],expected=401)
    managed=call("POST","/keys",data={"label":"ci-manage","permission":"manage","ttlSeconds":600},expected=201)
    call("POST","/keys",token=managed["token"],data={"label":"escalation","permission":"manage","ttlSeconds":600},expected=403)
    call("POST","/computers/plan",token=managed["token"],data=spec)
    call("DELETE","/keys/"+managed["id"])
    with open("evidence/account-key-checks.json","w") as f: json.dump({"rotation":True,"revocation":True,"readOnly":True,"tenantIsolation":True},f)
    call("GET","/computers/"+vm,token=b,expected=404)
    capture("/computers/"+vm+"/screenshot",token=b,expected=404)
    capture("/computers/"+vm+"/screenshot",token="invalid",expected=401)
    capture("/computers/"+vm+"/screenshot",expected=409)
    halted_guest=call("GET","/computers/"+vm+"/guest")
    assert halted_guest["available"] is False and halted_guest["console"]["supported"] is False
    assert call("GET","/computers/"+vm+"/storage")["mode"]=="ephemeral"
    call("GET","/computers/"+vm+"/storage",token=b,expected=404)
    assert all(x["id"]!=vm for x in call("GET","/computers",token=b))
    call("GET","/operations/"+created["operationId"],token=b,expected=404)
    for action in ("start","stop","restart"):
        call("POST","/computers/"+vm+"/"+action,token=b,data={},key=key(),expected=404)
    denied_key=key()
    denied=call("DELETE","/computers/"+vm,token=b,key=denied_key,expected=404)
    assert call("DELETE","/computers/"+vm,token=b,key=denied_key,expected=404)==denied
    call("POST","/computers/"+vm+"/start",data={},key=key(),expected=202)
    before=wait_for("first-start",running)
    original_uid=before["instance"]["metadata"]["uid"]
    # Explicit capture of this disposable smoke guest only. No cursor movement.
    png=capture("/computers/"+vm+"/screenshot")
    screenshot_meta=verify_png(png)
    with open("evidence/guest-display.png","wb") as f: f.write(png)
    with open("evidence/guest-display.json","w") as f: json.dump(screenshot_meta,f)
    tickets="/computers/"+vm+"/console-tickets"
    call("POST",tickets,token=b,expected=404)
    grant=call("POST",tickets,expected=201)
    assert grant["scope"]=="screenshot-only" and grant["instanceUid"]==original_uid
    display_token=grant["token"]
    assert grant["authorizationScheme"]=="Console"
    assert all("token" not in t and "tokenHash" not in t for t in call("GET",tickets))
    verify_png(capture("/computers/"+vm+"/screenshot",token=display_token,scheme="Console"))
    capture("/computers/vm-"+"0"*32+"/screenshot",token=display_token,scheme="Console",expected=401)
    call("GET","/account",token=display_token,scheme="Console",expected=401)
    call("DELETE",tickets+"/"+grant["id"],token=b,expected=404)
    call("DELETE",tickets+"/"+grant["id"])
    capture("/computers/"+vm+"/screenshot",token=display_token,scheme="Console",expected=401)
    # Do not record ticket values in evidence or logs.
    with open("evidence/display-ticket-checks.json","w") as f: json.dump({"scope":"screenshot-only","crossVmDenied":True,"revokedDenied":True},f)
    capture("/computers/"+vm+"/screenshot",token=b,expected=404)
    guest=call("GET","/computers/"+vm+"/guest")
    assert guest["available"] and guest["phase"]=="Running" and guest["ready"] is True
    assert guest["evidenceLevel"]=="kubevirt-status-only"
    assert guest["console"]["supported"] is True and "authorized ticket" in guest["console"]["reason"]
    with open("evidence/guest-observation.json","w") as f: json.dump(guest,f,indent=2)
    call("PATCH","/computers/"+vm+"/hardware",data={"cpu":2,"memoryMiB":768,"expectedResourceVersion":before["resourceVersion"]},key=key(),expected=409)
    assert before["instance"]["spec"]["volumes"][0]["containerDisk"]["image"]==images[0]["image"]
    assert before["instance"]["spec"]["domain"]["cpu"]["cores"]==spec["cpu"]
    assert before["instance"]["spec"]["architecture"]==spec["architecture"]
    call("POST","/computers/"+vm+"/restart",data={},key=key(),expected=202)
    def restarted(state):
        instance=state.get("instance") or {}
        return instance.get("metadata",{}).get("uid") not in (None,original_uid) and running(state)
    wait_for("restart",restarted)
    with open("evidence/running.json","w") as f: json.dump(before,f,indent=2)
    call("POST","/computers/"+vm+"/stop",data={},key=key(),expected=202)
    stopped=wait_for("stop",lambda state:state["instance"] is None)
    capture("/computers/"+vm+"/screenshot",expected=409)
    stopped=wait_for("halted-config-ready",lambda state:state["instance"] is None and state["desired"]["runStrategy"]=="Halted" and not (state.get("status") or {}).get("stateChangeRequests") and not (state.get("status") or {}).get("created"))
    hw={"cpu":2,"memoryMiB":768,"expectedResourceVersion":stopped["resourceVersion"]}
    call("PATCH","/computers/"+vm+"/hardware",token=b,data=hw,key=key(),expected=404)
    call("PATCH","/computers/"+vm+"/hardware",data={**hw,"cpu":100},key=key(),expected=422)
    call("PATCH","/computers/"+vm+"/hardware",data={**hw,"expectedResourceVersion":"0"},key=key(),expected=409)
    planned=call("POST","/computers/"+vm+"/hardware/plan",data=hw)
    assert planned["dryRun"] and planned["desired"]["template"]["spec"]["domain"]["cpu"]["cores"]==2
    unchanged=call("GET","/computers/"+vm)
    assert unchanged["desired"]["template"]["spec"]["domain"]["cpu"]["cores"]==1
    hw["expectedResourceVersion"]=unchanged["resourceVersion"]
    resize_key=key()
    resized=call("PATCH","/computers/"+vm+"/hardware",data=hw,key=resize_key,expected=202)
    assert call("PATCH","/computers/"+vm+"/hardware",data=hw,key=resize_key,expected=202)==resized
    call("POST","/computers/"+vm+"/start",data={},key=key(),expected=202)
    after=wait_for("second-start",running)
    domain=after["instance"]["spec"]["domain"]
    assert domain["cpu"]["cores"]==2
    assert domain["memory"]["guest"]=="768Mi"
    with open("evidence/cold-resize.json","w") as f: json.dump({"before":before["instance"]["spec"]["domain"],"after":domain,"vm":vm},f,indent=2)
finally:
    # Record final observed state before API cleanup; never hide the original failure.
    try: record("pre-delete",call("GET","/computers/"+vm))
    finally: call("DELETE","/computers/"+vm,key=key(),expected=202)
end=time.monotonic()+120
while time.monotonic()<end:
    if all(x["id"]!=vm for x in call("GET","/computers")): break
    time.sleep(3)
else: raise AssertionError("Deleted VM remains visible")
call("GET","/computers/"+vm,expected=404)
print("Lifecycle and account-isolation smoke passed; guest desktop/boot verification is NOT covered.")
