"""Real VM control proof: only public product API calls, no guest/cluster bypass.

Raw MP4 is returned by the platform. The separate evidence presentation adds an
actual HTTP trace panel, not a simulated terminal or frame-synchronized trace.
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = os.environ.get("API_URL", "http://127.0.0.1:3000/api/v1")
A, B = os.environ["TOKEN_A"], os.environ["TOKEN_B"]
OUT = Path(os.environ.get("PROOF_OUTPUT_DIR", "evidence/api-control-proof"))
OUT.mkdir(parents=True, exist_ok=True)
TRACE = OUT / "http-trace.jsonl"
TRACE.write_text("")
START = time.monotonic()
events = []

def sha(data):
    return hashlib.sha256(data).hexdigest()

def call(method, path, token=A, body=None, expected=200, scheme="Bearer",
         idem=None, binary=False, phase=None, raw=None, extra_headers=None, timeout=30):
    req = urllib.request.Request(
        BASE + path,
        data=raw if raw is not None else json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": scheme + " " + token,
                 "Content-Type": "application/json",
                 "Idempotency-Key": idem or str(uuid.uuid4()), **(extra_headers or {})},
        method=method,
    )
    t = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            code, data, headers = res.status, res.read(65 * 1024 * 1024), res.headers
    except urllib.error.HTTPError as exc:
        code, data, headers = exc.code, exc.read(16384), exc.headers
    allowed = (expected,) if isinstance(expected, int) else expected
    declared = code if code in allowed else allowed[0]
    entry = {"elapsedMs": round((t-START)*1000), "method": method,
             "path": path, "status": code, "expected": declared,
             "responseMs": round((time.monotonic()-t)*1000)}
    if phase:
        entry["phase"] = phase
    # No Authorization, secrets, request bodies, response bodies, or keystrokes.
    events.append(entry)
    with TRACE.open("a") as stream:
        stream.write(json.dumps(entry) + "\n")
    if phase or code not in allowed:
        print(method, path, code, phase or "", flush=True)
    assert code in allowed, (method, path, code, expected)
    return (data, headers) if binary else json.loads(data)

def wait(check, seconds, reason):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(1.5)
    raise AssertionError(reason)

def cold_resize(path, cpu, memory_mib):
    def halted():
        v = call("GET", path)
        s = v.get("status") or {}
        return v if v["instance"] is None and v["desired"]["runStrategy"] == "Halted" and not any(s.get(k) for k in ("stateChangeRequests", "created", "ready")) else None
    initial = wait(halted, 120, "VM did not converge to halted")["desired"]
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        v = halted()
        assert v and v["desired"] == initial, "Unexpected desired configuration change"
        body = {"cpu":cpu,"memoryMiB":memory_mib,"expectedResourceVersion":v["resourceVersion"]}
        key = str(uuid.uuid4())
        result = call("PATCH", path+"/hardware", body=body, idem=key, expected=(202,409), phase="cold resize")
        if result.get("error"):
            assert result["error"] in ("Configuration version changed; inspect current VM", "Kubernetes rejected request (409)"), result
            assert call("PATCH",path+"/hardware",body=body,idem=key,expected=409)==result
            time.sleep(1)
            continue
        assert result["status"]=="submitted", result
        assert call("PATCH",path+"/hardware",body=body,idem=key,expected=202)==result
        return result
    raise AssertionError("Cold resize optimistic concurrency did not stabilize")

def ocr(file):
    text = subprocess.check_output(
        ["tesseract", str(file), "stdout", "--psm", "6", "--dpi", "180"],
        stderr=subprocess.DEVNULL, timeout=15, text=True)
    return re.sub(r"[^a-z0-9]", "", text.lower()), text.lower()

def screen(path, file):
    data, headers = call("GET", path + "/screenshot", binary=True)
    assert headers.get("Content-Type") == "image/png"
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    file.write_bytes(data)
    return ocr(file)

def batch(text):
    return {"events": [{"type": "key", "keysym": ord(ch), "down": down}
                        for ch in text for down in (True, False)]}

def check_video(raw, first, second):
    # Decode every frame first; then inspect the actual captured frames, not
    # API screenshots substituted into a synthetic recording.
    subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(raw),
                    "-f", "null", "-"], check=True, timeout=90)
    probe = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of",
         "json", str(raw)], timeout=30))
    assert len(probe["streams"]) == 1
    assert probe["streams"][0]["codec_name"] == "h264"
    assert float(probe["format"]["duration"]) > 0
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(raw), "-vf",
                        "fps=2", str(Path(tmp)/"frame-%05d.png")],
                       check=True, timeout=90)
        first_frame = None
        final_frame = None
        frames = sorted(Path(tmp).glob("frame-*.png"))
        assert len(frames) >= 4
        for frame in frames:
            normalized, _ = ocr(frame)
            if first_frame is None and normalized.count(first) == 1 and second not in normalized:
                first_frame = frame.name
                (OUT/"video-first-marker.png").write_bytes(frame.read_bytes())
            if first_frame and second in normalized:
                assert normalized.count(second) == 1, "Duplicate marker in actual video"
                final_frame = frame.name
                (OUT/"video-final-marker.png").write_bytes(frame.read_bytes())
                break
        assert first_frame and final_frame, "Video did not show ordered real guest actions"
    return {"firstFrame": first_frame, "finalFrame": final_frame,
            "codec": "h264", "markers":{"before":first,"after":second}, "durationSeconds": float(probe["format"]["duration"]),
            "fullDecode": True}

def presentation(raw, title="REAL API CONTROL PROOF"):
    # Static side panel contains only observed trace entries. It does not
    # imply exact wall-clock/frame synchronization (capture is sampled).
    phases = [e for e in events if e.get("phase") and e["status"] == e["expected"]]
    lines = [title, "Actual API-retrieved guest video (left)",
             "Observed script HTTP calls (below)", "Trace is not frame-synchronized", ""]
    for e in phases:
        if e["phase"] in {"create", "start", "controller key", "control ticket",
                          "record start", "lease acquire", "first input",
                          "second input", "idempotent replay", "lease release",
                          "record stop", "retrieve MP4", "stop", "delete", "upload file", "download file", "guest action"}:
            lines.append(f'{e["elapsedMs"]/1000:7.1f}s  {e["method"]:6s} {e["status"]}  {e["phase"]}')
    if len(lines)>27:lines=lines[:24]+["... full trace in companion JSONL"]+lines[-2:]
    lines += ["", "Full HTTP trace and SHA256: companion files", "No credentials recorded"]
    panel = OUT/"presentation-trace.txt"
    panel.write_text("\n".join(lines)+"\n")
    output = OUT/"api-control-presentation.mp4"
    # Text file is generated from fixed labels and numerical response codes.
    # Raw platform MP4 remains unchanged and independently verifiable.
    filt = ("scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,"
            "pad=1920:720:0:0:color=0x15202b,"
            "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:"
            f"textfile={panel}:x=1300:y=35:fontsize=16:fontcolor=white:line_spacing=4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw),
                    "-vf", filt, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", str(output)], check=True, timeout=120)
    subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(output),
                    "-f", "null", "-"], check=True, timeout=90)
    return {"file": output.name, "sha256": sha(output.read_bytes()),
            "derivedFrom": raw.name, "tracePanel": panel.name, "frameSynchronized": False}

def main():
    path = None
    record = None
    key_id = None
    ticket = None
    lease = False
    stopped = False
    proof = None
    # No guest credentials are entered. The visible guest login prompt is
    # the controlled target, not evidence of a logged-in application.
    first, second = "scriptstart", "scriptdone"
    try:
        vm = call("POST", "/computers", body={"version": 1, "name": "api-control-proof",
                  "architecture": "amd64", "cpu": 1, "memoryMiB": 512,
                  "image": "cirros-smoke"}, expected=202, phase="create")
        path = "/computers/" + vm["result"]["id"]
        call("GET", path, B, expected=404, phase="cross-account denial")
        call("POST", path+"/start", body={}, expected=202, phase="start")
        def running():
            instance = call("GET", path).get("instance")
            return instance["metadata"]["uid"] if instance and instance["status"]["phase"] == "Running" else None
        uid = wait(running, 360, "VMI not Running")
        before = OUT/"before.png"
        def ready():
            normalized, text = screen(path, before)
            # The pinned CirrOS kernel emits an asynchronous entropy message
            # onto the login tty. Wait for it BEFORE the consented input test.
            # Run 45770716860 retained the interrupted marker in a real PNG.
            return (bool(re.search(r"login\s*:", text)) and
                    "nonblockingpoolisinitialized" in normalized and
                    first not in normalized and second not in normalized)
        wait(ready, 240, "No real login prompt with initialized entropy pool")
        key = call("POST", "/keys", body={"label":"api-control-proof", "permission":"manage",
                   "ttlSeconds":600}, expected=201, phase="controller key")
        key_id = key["id"]
        grant = call("POST", path+"/console-tickets", key["token"],
                     {"scope":"control-vnc"}, expected=201, phase="control ticket")
        assert grant["actor"] == "automation" and grant["instanceUid"] == uid
        ticket = grant["token"]
        collection = path+"/recordings"
        call("POST", collection, body={"consent":False,"maxSeconds":90},
             expected=422, phase="consent denial")
        k = str(uuid.uuid4())
        started = call("POST", collection, body={"consent":True,"maxSeconds":90},
                       expected=202, idem=k, phase="record start")
        record = collection+"/"+started["result"]["id"]
        assert started["result"]["instanceUid"] == uid
        assert call("POST", collection, body={"consent":True,"maxSeconds":90},
                    expected=202, idem=k)["result"]["id"] == started["result"]["id"]
        call("GET", record, B, expected=404, phase="record ownership denial")
        def active():
            state = call("GET", record)
            assert state["status"] not in ("failed","completed"), state["status"]
            return state["status"] == "recording"
        wait(active, 20, "Recording did not start")
        time.sleep(4)
        call("POST", path+"/input", ticket, batch(first), expected=409,
             scheme="Console", phase="unleased input denial")
        assert first not in screen(path, OUT/"denied-input.png")[0], "Unleased input reached guest"
        claim = call("POST", path+"/input-lease", ticket, {}, scheme="Console", phase="lease acquire")
        lease = True
        assert claim["active"] and claim["actor"] == "automation"
        one = call("POST", path+"/input", ticket, batch(first), expected=202,
                   scheme="Console", phase="first input")
        assert one["result"]["accepted"] == len(first)*2
        after_first = OUT/"after-first.png"
        wait(lambda: screen(path, after_first)[0].count(first) == 1, 18, "First input not visible exactly once")
        time.sleep(5)
        call("POST", path+"/input-lease", ticket, {}, scheme="Console")
        k2 = str(uuid.uuid4())
        two = call("POST", path+"/input", ticket, batch(second), expected=202,
                   scheme="Console", idem=k2, phase="second input")
        assert two["result"]["accepted"] == len(second)*2
        replay = call("POST", path+"/input", ticket, batch(second), expected=202,
                      scheme="Console", idem=k2, phase="idempotent replay")
        assert replay == two
        after_second = OUT/"after-second.png"
        def final_screen():
            text, _ = screen(path, after_second)
            return second in text and text.count(second) == 1
        wait(final_screen, 18, "Second input not visible or duplicated")
        time.sleep(6)
        call("DELETE", path+"/input-lease", ticket, scheme="Console", phase="lease release")
        lease = False
        call("POST", record+"/stop", body={}, expected=202, phase="record stop")
        def completed():
            state = call("GET", record)
            assert state["status"] != "failed", "Recording failed"
            return state if state["status"] == "completed" else None
        meta = wait(completed, 100, "Recording did not complete")
        assert meta["instanceUid"] == uid
        data, headers = call("GET", record+"/file", binary=True, phase="retrieve MP4")
        assert headers.get("Content-Type") == "video/mp4"
        assert 0 < len(data) <= 64*1024*1024 and len(data) == meta["bytes"]
        assert sha(data) == meta["sha256"]
        raw = OUT/"platform-recording.mp4"
        raw.write_bytes(data)
        video = check_video(raw, first, second)
        call("GET", record+"/file", B, expected=404, phase="video ownership denial", binary=True)
        call("DELETE", record, expected=202, phase="delete recording")
        call("GET", record, expected=404)
        record = None
        call("DELETE", "/keys/"+key_id, phase="revoke controller key")
        key_id = None
        call("POST", path+"/input-lease", ticket, {}, expected=401, scheme="Console",
             phase="revoked key denial")
        call("POST", path+"/stop", body={}, expected=202, phase="stop")
        wait(lambda: call("GET", path).get("instance") is None, 240, "Stop not converged")
        stopped = True
        call("DELETE", path, expected=202, phase="delete")
        wait(lambda: not any(x["id"] == vm["result"]["id"] for x in call("GET", "/computers")),
             120, "Delete not converged")
        path = None
        derived = presentation(raw)
        proof = {"scope":"real native x86 guest login-screen control via HTTP API",
                 "runId":os.environ.get("GITHUB_RUN_ID"), "commit":os.environ.get("GITHUB_SHA"),
                 "vmId":vm["result"]["id"], "instanceUid":uid,
                 "actualGuestBootScreen":True, "guestLoginOrApplicationExecutionVerified":False,
                 "automationLease":True, "unleasedInputDenied":True, "idempotentReplay":True,
                 "crossAccountDenied":True, "keyRevoked":True, "stoppedAndDeleted":stopped,
                 "recording":{"file":raw.name,"bytes":len(data),"sha256":meta["sha256"],
                              **video}, "derivedPresentation":derived,
                 "screenshots":{p.name:sha(p.read_bytes()) for p in
                                 [before, after_first, after_second]},
                 "trace":{"file":TRACE.name,"sha256":sha(TRACE.read_bytes()),"calls":len(events)}}
        (OUT/"verification.json").write_text(json.dumps(proof, indent=2)+"\n")
        print("Verified real script-driven guest input, raw API MP4 and annotated evidence")
    finally:
        # Cleanup is best-effort after failure; never obscure the original error.
        for method, endpoint, token, scheme, body, expected in [
            ("DELETE", path+"/input-lease" if path and lease else None, ticket, "Console", None, 200),
            ("POST", record+"/stop" if record else None, A, "Bearer", {}, 202),
            ("DELETE", "/keys/"+key_id if key_id else None, A, "Bearer", None, 200),
            ("DELETE", path, A, "Bearer", None, 202),
        ]:
            if endpoint and token:
                try:
                    call(method, endpoint, token, body, expected, scheme)
                except Exception:
                    print("Cleanup incomplete:", method, endpoint, flush=True)

if __name__ == "__main__":
    main()
