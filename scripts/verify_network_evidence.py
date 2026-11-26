"""Independently verify retained native HTTP/tunnel evidence, not certify hardware."""
import argparse
import hashlib
import json
import re
from pathlib import Path

def require(ok,message):
    if not ok:raise ValueError(message)

def verify(root,commit,run):
    p=json.loads((root/"network-verification.json").read_text())
    require(re.fullmatch(r"[a-f0-9]{40}",commit) and p["commit"]==commit and p["runId"]==run,"Unexpected execution identity")
    require(all(p[k] is True for k in ("nativeGuestHttp","loopbackTcpRelayVerified","clusterApiEgressBlocked","crossAccountDenied","duplicateConnectionDenied","revokedDisconnect","stopDisconnect")),"Incomplete tunnel proof")
    marker=p["marker"]
    require(re.fullmatch(r"network-marker-[a-f0-9-]{36}",marker),"Invalid guest marker")
    for name,key in (("guest","guestResponseSha256"),("relay","relayResponseSha256")):
        raw=(root/("network-"+name+"-response.txt")).read_bytes()
        require(0<len(raw)<=65536 and hashlib.sha256(raw).hexdigest()==p[key],"Guest response hash mismatch")
        header,sep,body=raw.partition(b"\r\n\r\n")
        require(sep and header.splitlines()[0]==b"HTTP/1.0 200 OK","Missing actual HTTP 200 response")
        require(body.rstrip(b"\r\n")==marker.encode()+b"\ncluster-egress-blocked","Guest marker or egress mismatch")
        sizes=[x.split(b":",1)[1].strip() for x in header.splitlines() if x.lower().startswith(b"content-length:")]
        # A previous client stopped reading as soon as the entire marker was
        # visible. Require exactly the fixture bytes and final LF here.
        require(sizes==[str(len(body)).encode()],"Incomplete native HTTP body")
    raw=(root/"network-http.jsonl").read_bytes()
    require(hashlib.sha256(raw).hexdigest()==p["traceSha256"],"Complete network trace hash mismatch")
    rows=[json.loads(x) for x in raw.splitlines() if x]
    require(rows and all(set(x)<={"method","path","actor","expected","status","phase","transport"} for x in rows),"Unexpected trace fields")
    for x in rows:
        if x.get("transport") is not None:
            require(x["method"]=="GET","Unexpected mutation transport failure")
        elif x["status"]!=x["expected"]:
            require(x["method"]=="WSS" and ((x.get("phase")=="ready" and x["status"] in (409,502)) or (x.get("phase")=="reconnect" and x["status"]==409)),"Unexpected HTTP or WSS failure")
    vm=r"/computers/vm-[a-f0-9]{32}"
    tunnel=vm+r"/exposures/[a-f0-9-]{36}/connect"
    def found(method,pattern,expected,actor=None):
        return any(x["method"]==method and re.fullmatch(pattern,x["path"]) and x.get("status")==expected and x["expected"]==expected and (actor is None or x.get("actor")==actor) for x in rows)
    require(found("POST",vm+"/exposures",404,"foreign") and found("POST",vm+"/exposures",422,"owner") and found("POST",vm+"/exposures",201,"owner"),"Missing exposure authorization")
    require(found("WSS",tunnel,101) and found("WSS",tunnel,409) and sum(x["method"]=="WSS" and x.get("status")==401 and x["expected"]==401 for x in rows)>=3,"Missing WSS authorization and duplicate denial")
    require(found("DELETE",vm+r"/exposures/[a-f0-9-]{36}",200,"owner") and found("POST",vm+"/stop",202,"owner") and found("DELETE",vm+r"\?deleteDisks=true",202,"owner"),"Missing revoke, stop or cleanup")
    require(found("GET",r"/operations/[a-f0-9-]{36}",200,"owner"),"Missing deletion observation")
    return {"commit":commit,"runId":run,"httpAndUpgradeCalls":len(rows),"guestAndRelayResponseVerified":True,"hardwareCertifiedByVerifier":False}

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--commit",required=True)
    p.add_argument("--run-id",required=True)
    a=p.parse_args()
    print(json.dumps(verify(a.root,a.commit,a.run_id),indent=2))
