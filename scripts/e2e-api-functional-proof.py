"""API-only end-to-end native guest program + VirtioFS + real video proof.
The client supplies a tiny guest-native test application via cloud-init.
No platform agent, guest remote shell, login bypass, or Kubernetes operations.
"""
import os
os.environ["PROOF_OUTPUT_DIR"] = "evidence/api-functional-proof"
import runpy
from pathlib import Path
import hashlib
import json
import time
import uuid
import secrets
from linux_showcase_fixture import package, verify_archive, launcher_cloud

h = runpy.run_path(str(Path(__file__).with_name("e2e-api-control-proof.py")), run_name="proof_helpers")
call, wait, screen, batch = (h[x] for x in ("call", "wait", "screen", "batch"))
OUT, A, B = h["OUT"], h["A"], h["B"]

# Cloud-init is only the disposable guest launcher. The actual application is
# uploaded independently via the file API and installed by a visible command.


def main():
    vm = path = recording = key_id = ticket = None
    lease = False
    try:
        software=package()
        software_digest=h["sha"](software)
        cloud=launcher_cloud()
        assert len(cloud.encode("utf-8"))<=2048, "KubeVirt inline cloud-init limit"
        spec = {"version":1,"name":"api-functional-proof","architecture":"amd64",
                "cpu":1,"memoryMiB":1536,"image":"fedora-exchange-test",
                "storage":{"systemGiB":8,"exchangeGiB":1,"exchangeMode":"virtiofs"},
                "cloudInit":cloud}
        call("POST", "/computers/plan", body=spec)
        vm = call("POST", "/computers", body=spec, expected=202, phase="create")
        path = "/computers/" + vm["result"]["id"]
        def cold_disk(action,name,**fields):
            initial=call("GET",path)["desired"]
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                current=call("GET",path)
                assert current["desired"]==initial
                body={"action":action,"name":name,"expectedResourceVersion":current["resourceVersion"],**fields}
                planned=call("POST",path+"/disks/plan",body=body,expected=(200,409))
                if planned.get("error"):
                    assert planned["error"] in ("VM identity or resource version changed","VM resource version changed before disk reservation"),planned
                    time.sleep(1);continue
                current=call("GET",path)
                assert current["desired"]==initial
                body["expectedResourceVersion"]=current["resourceVersion"]
                key=str(uuid.uuid4())
                submitted=call("POST",path+"/disks",body=body,idem=key,expected=(202,409),phase="cold disk "+action)
                if submitted.get("error"):
                    assert submitted["error"] in ("VM identity or resource version changed","VM resource version changed before disk reservation"),submitted
                    assert call("POST",path+"/disks",body=body,idem=key,expected=409)==submitted
                    time.sleep(1);continue
                assert submitted["status"]=="submitted"
                assert call("POST",path+"/disks",body=body,idem=key,expected=202)==submitted
                return submitted
            raise AssertionError("Cold disk version did not stabilize")
        def get_disk(name):
            return next((v for v in call("GET",path+"/storage")["volumes"] if v.get("diskName")==name),None)
        cold_disk("create","proof",sizeGiB=1)
        cold_disk("attach","proof")
        images=call("GET","/images")
        image=next(i for i in images if i["id"]==spec["image"])
        assert image["architecture"]=="amd64" and image["digest"].startswith("sha256:") and image["image"].endswith(image["digest"])
        data = secrets.token_bytes(4096)
        digest = h["sha"](data)
        expected = b"guest-result:" + digest.encode("ascii") + b"\n"
        call("PUT", path+"/files/challenge.bin", B, expected=404, raw=data,
             extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":digest})
        upload = call("PUT", path+"/files/challenge.bin", expected=202, raw=data,
                      extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":digest},
                      phase="upload file")
        assert upload["result"]["sha256"] == digest
        software_upload=call("PUT",path+"/files/proof.zip",expected=202,raw=software,extra_headers={"Content-Type":"application/octet-stream","X-Content-SHA256":software_digest},phase="upload software")
        assert software_upload["result"]["sha256"]==software_digest
        assert call("GET", path+"/files") == []
        call("POST", path+"/start", body={}, expected=202, phase="start")
        def running():
            i = call("GET", path).get("instance")
            return i["metadata"]["uid"] if i and i["status"]["phase"] == "Running" else None
        uid = wait(running, 420, "VMI not Running")
        def identities():
            volumes=call("GET",path+"/storage")["volumes"]
            if not all(v["pvcPhase"]=="Bound" and v["pvcUid"] for v in volumes):return None
            return {v.get("diskName",v["kind"]):v["pvcUid"] for v in volumes}
        original=wait(identities,120,"Persistent storage not bound")
        assert set(original)=={"boot","exchange","proof"}
        def ready():
            text, _ = screen(path, OUT/"before.png")
            return "proofready" in text and "proofcomplete" not in text
        wait(ready, 300, "Client-supplied guest app not visible")
        assert call("GET", path+"/files") == [], "Result exists before guest interaction"
        k = call("POST", "/keys", body={"label":"functional-proof","permission":"manage","ttlSeconds":600},
                 expected=201, phase="controller key")
        key_id = k["id"]
        grant = call("POST", path+"/console-tickets", k["token"], {"scope":"control-vnc"},
                     expected=201, phase="control ticket")
        ticket = grant["token"]
        assert grant["actor"] == "automation" and grant["instanceUid"] == uid
        started = call("POST", path+"/recordings", body={"consent":True,"maxSeconds":90},
                       expected=202, phase="record start")
        recording = path+"/recordings/"+started["result"]["id"]
        def active():
            state = call("GET", recording)
            assert state["status"] != "failed"
            return state["status"] == "recording"
        wait(active, 20, "Recording did not start")
        time.sleep(5)
        claim = call("POST", path+"/input-lease", ticket, {}, scheme="Console", phase="lease acquire")
        lease = True
        assert claim["active"] and claim["actor"] == "automation"
        events = batch("runproof")["events"] + [
            {"type":"key","keysym":0xff0d,"down":True},
            {"type":"key","keysym":0xff0d,"down":False}]
        idem = str(uuid.uuid4())
        action = call("POST", path+"/input", ticket, {"events":events}, expected=202,
                      scheme="Console", idem=idem, phase="guest action")
        assert action["result"]["accepted"] == len(events)
        assert call("POST", path+"/input", ticket, {"events":events}, expected=202,
                    scheme="Console", idem=idem, phase="idempotent replay") == action
        wait(lambda: "proofcomplete" in screen(path, OUT/"after.png")[0], 25,
             "Actual guest computation not visible")
        wait(lambda: any(f["name"]=="result.bin" for f in call("GET", path+"/files")),
             20, "Guest output not published")
        result, headers = call("GET", path+"/files/result.bin", binary=True, phase="download file")
        assert result == expected
        assert headers.get("X-Content-SHA256") == h["sha"](result)
        call("GET", path+"/files/result.bin", B, expected=404, binary=True)
        (OUT/"guest-result.bin").write_bytes(result)
        wait(lambda:any(f["name"]=="archive.zip" for f in call("GET",path+"/files")),20,"Guest archive not published")
        archive, ah=call("GET",path+"/files/archive.zip",binary=True,phase="download archive")
        verify_archive(archive,data)
        assert ah.get("X-Content-SHA256")==h["sha"](archive)
        (OUT/"guest-archive.zip").write_bytes(archive)
        (OUT/"challenge.bin").write_bytes(data)
        (OUT/"software.zip").write_bytes(software)
        def retrieve(name):
            wait(lambda:any(f["name"]==name for f in call("GET",path+"/files")),60,"Missing guest output "+name)
            raw,headers=call("GET",path+"/files/"+name,binary=True,phase="download "+name)
            assert headers["X-Content-SHA256"]==h["sha"](raw)
            (OUT/name).write_bytes(raw)
            return raw
        assert retrieve("disk-original.bin")==data
        platform=retrieve("guest-platform.json")
        rpm=retrieve("guest-rpm.tsv")
        from linux_showcase_fixture import verify_platform
        verify_platform(platform,rpm,image["version"])
        time.sleep(5)
        call("DELETE", path+"/input-lease", ticket, scheme="Console", phase="lease release")
        lease = False
        call("POST", recording+"/stop", body={}, expected=202, phase="record stop")
        def complete():
            state = call("GET", recording)
            assert state["status"] != "failed"
            return state if state["status"] == "completed" else None
        meta = wait(complete, 100, "Recording did not complete")
        video, headers = call("GET", recording+"/file", binary=True, phase="retrieve MP4")
        assert meta["instanceUid"] == uid and headers.get("Content-Type") == "video/mp4"
        assert len(video) == meta["bytes"] and h["sha"](video) == meta["sha256"]
        raw = OUT/"platform-recording.mp4"
        raw.write_bytes(video)
        decoded = h["check_video"](raw, "proofready", "proofcomplete")
        call("GET", recording+"/file", B, expected=404, binary=True)
        call("DELETE", recording, expected=202)
        recording = None
        call("DELETE", "/keys/"+key_id)
        key_id = None
        call("POST", path+"/stop", body={}, expected=202, phase="stop")
        wait(lambda: call("GET", path)["instance"] is None, 240, "VM stop did not converge")
        stored, _ = call("GET", path+"/files/result.bin", binary=True)
        assert stored == expected
        def halted():
            v=call("GET",path);s=v.get("status") or {}
            return not v["instance"] and v["desired"]["runStrategy"]=="Halted" and not any(s.get(k) for k in ("created","ready","stateChangeRequests"))
        wait(halted,120,"VM did not fully stop before clone")
        cloned=cold_disk("clone","proofcopy",source="proof",sizeGiB=2)
        copy=wait(lambda:(d if (d:=get_disk("proofcopy")) and d["dataVolumePhase"]=="Succeeded" and d["pvcPhase"]=="Bound" and d["pvcUid"] else None),420,"Clone failed to converge")
        assert copy["pvcUid"]!=original["proof"]
        wait(lambda:call("GET","/operations/"+cloned["operationId"]).get("observation",{}).get("state")=="converged",120,"Clone observation failed")
        cold_disk("attach","proofcopy")
        h["cold_resize"](path,2,2048)
        call("POST",path+"/start",body={},expected=202,phase="restart after resize")
        new_uid=wait(running,420,"Resized VMI not Running")
        assert new_uid!=uid and identities()=={**original,"proofcopy":copy["pvcUid"]}
        domain=call("GET",path)["instance"]["spec"]["domain"]
        assert domain["cpu"]["cores"]==2 and domain["memory"]["guest"] in ("2048Mi","2Gi")
        wait(lambda:"proofpersisted" in screen(path,OUT/"reboot.png")[0],240,"Installed application did not persist after reboot")
        assert call("GET",path+"/files/result.bin",binary=True)[0]==expected
        assert call("GET",path+"/files/archive.zip",binary=True)[0]==archive
        assert retrieve("disk-original-after.bin")==data
        assert retrieve("disk-clone-after.bin")==bytes(x^255 for x in data)
        call("POST",path+"/stop",body={},expected=202,phase="stop after resize")
        wait(lambda:call("GET",path)["instance"] is None,240,"Final stop failed")
        call("DELETE", path, expected=409)
        call("DELETE", path+"?deleteDisks=true", expected=202, phase="delete")
        wait(lambda: not any(x["id"] == vm["result"]["id"] for x in call("GET", "/computers")),
             120, "VM delete did not converge")
        path = None
        derived = h["presentation"](raw, "REAL NATIVE APPLICATION PROOF")
        proof = {"scope":"native Fedora uploaded and installed Linux archive application, product APIs only",
                 "profile":"linux","architecture":"amd64","image":image,"softwareSha256":software_digest,"archiveSha256":h["sha"](archive),
                 "softwareInstalled":True,"coldResizeAndFilePersistence":True,"originalPvcUids":original,"clonePvcUid":copy["pvcUid"],"guestDiskCloneByteProof":True,"guestPlatformSha256":h["sha"](platform),"guestRpmSha256":h["sha"](rpm),"resizedInstanceUid":new_uid,"rebootScreenshotSha256":h["sha"]((OUT/"reboot.png").read_bytes()),
                 "runId":os.environ.get("GITHUB_RUN_ID"), "commit":os.environ.get("GITHUB_SHA"),
                 "vmId":vm["result"]["id"], "instanceUid":uid,
                 "inputBytes":len(data),"inputSha256":digest,"outputBytes":len(result),
                 "outputSha256":h["sha"](result),"guestComputedResult":True,
                 "actualGuestVisibleResult":True,"crossAccountDenied":True,
                 "replayedActionSameOperation":True,"stoppedOutputPersistent":True,
                 "recording":{"file":raw.name,"sha256":meta["sha256"],"bytes":len(video),**decoded},
                 "derivedPresentation":derived,
                 "traceSha256":h["sha"](h["TRACE"].read_bytes())}
        (OUT/"verification.json").write_text(json.dumps(proof, indent=2)+"\n")
        print("Linux application package installed and launched through API input; real archive, challenge, recording and resize/reboot persistence verified")
    finally:
        for method, endpoint, token, scheme, body, expected in [
            ("DELETE", path+"/input-lease" if path and lease else None, ticket, "Console", None, 200),
            ("POST", recording+"/stop" if recording else None, A, "Bearer", {}, 202),
            ("DELETE", "/keys/"+key_id if key_id else None, A, "Bearer", None, 200),
            ("DELETE", path+"?deleteDisks=true" if path else None, A, "Bearer", None, 202),
        ]:
            if endpoint and token:
                try:
                    call(method, endpoint, token, body, expected, scheme)
                except Exception:
                    print("Cleanup incomplete:", method, endpoint, flush=True)

if __name__ == "__main__":
    main()
