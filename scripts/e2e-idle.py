"""Real API-only idle-stop and redacted audit conformance."""
import os, runpy, time, json
from pathlib import Path
os.environ["PROOF_OUTPUT_DIR"]="evidence/idle-proof"
h=runpy.run_path(str(Path(__file__).with_name("e2e-api-control-proof.py")),run_name="proof_helpers")
call,wait=h["call"],h["wait"]
A,B=h["A"],h["B"]
vm=call("POST","/computers",body={"version":1,"name":"ci-idle","architecture":"amd64","cpu":1,"memoryMiB":512,"image":"cirros-smoke","idleStopSeconds":60},expected=202)
id=vm["result"]["id"];path="/computers/"+id
try:
    call("POST",path+"/start",body={},expected=202)
    wait(lambda:(call("GET",path).get("instance") or {}).get("status",{}).get("phase")=="Running",420,"Idle test guest not Running")
    wait(lambda:call("GET",path)["status"].get("ready") is True,90,"Guest not ready")
    ticket=call("POST",path+"/console-tickets",body={"scope":"control-vnc"},expected=201)
    def listed():
        return next(x for x in call("GET","/computers") if x["id"]==id)
    # List is not VM-specific activity. Ticket remains eligible for 120s.
    time.sleep(85)
    assert listed()["status"].get("ready") is True,"Active grant did not protect VM"
    call("DELETE",path+"/console-tickets/"+ticket["id"])
    wait(lambda:listed()["status"].get("printableStatus")=="Stopped",210,"Idle policy did not stop")
    # PrintableStatus can precede final VMI deletion.
    wait(lambda:call("GET",path)["instance"] is None,120,"Idle stop VMI deletion did not converge")
    assert any(e["actor"]=="system" and e["group"]=="stop" and e["computerId"]==id for e in call("GET","/audit"))
    assert all(e["computerId"]!=id for e in call("GET","/audit",B))
    (h["OUT"]/"verification.json").write_text(json.dumps({"activeGrantProtected":True,"idleStopped":True,"vmRetained":True,"accountAuditIsolated":True},indent=2))
finally:
    call("DELETE",path,expected=202)
