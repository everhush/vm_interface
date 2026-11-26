"""Independently check exact-candidate retained media evidence (no hardware claim)."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from evidence_frames import ocr

MODES=("direct","resumable","dual","url")
PUBLIC_SHA="7d6355852aeb6dbcd191bcda7cd74f1536cfe5cbf8a10495a7283a8396e4b75b"
PUBLIC_BYTES=21692416
OCI_SHA="a8dd75ecffd4cdd96072d60c2237b448e0c8b2bc94d57f10fdbc8c481d9005b8"
OCI_BYTES=12716032

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def require(ok,reason):
    if not ok:raise ValueError(reason)

def verify_media(root,commit,run_id,screen_ocr=ocr):
    require(re.fullmatch(r"[a-f0-9]{40}",commit),"Invalid exact commit")
    require(re.fullmatch(r"(?:[0-9]+|device-[0-9]{8}T[0-9]{6}Z-[0-9]+)",run_id),"Invalid execution identity")
    rows_by_mode={}
    for mode in MODES:
        proof=json.loads((root/("media-"+mode+"-verification.json")).read_text())
        digest,count=(PUBLIC_SHA,PUBLIC_BYTES) if mode=="url" else (OCI_SHA,OCI_BYTES)
        require(proof["commit"]==commit and proof["runId"]==run_id and proof["mode"]==mode,"Wrong media execution")
        require(proof["sha256"]==digest and proof["bytes"]==count,"Image pin mismatch")
        require(all(proof[k] is True for k in ("verifiedCDI","badDigestDenied","crossAccountDenied","idempotent","guestLoginVerified")),"Incomplete native media proof")
        screenshot=root/("imported-disk-"+mode+"-display.png")
        require(sha(screenshot)==proof["screenshotSha256"] and "cirroslogin" in screen_ocr(screenshot),"Missing original guest login")
        trace=root/("media-"+mode+"-http.jsonl")
        require(sha(trace)==proof["traceSha256"],"Media HTTP trace checksum mismatch")
        rows=[json.loads(line) for line in trace.read_text().splitlines() if line]
        require(rows and all(set(x)<= {"method","path","actor","expected","status","bodyBytes","bodySha256"} and x["status"]==x["expected"] for x in rows),"Failed or invalid HTTP trace")
        def found(method,pattern,actor,status,body=None):
            return any(x["method"]==method and re.fullmatch(pattern,x["path"]) and x["actor"]==actor and x["status"]==status and (body is None or x.get("bodyBytes")==body) for x in rows)
        vm=r"/computers/vm-[a-f0-9]{32}"
        boot=vm+"/media/boot"
        require(found("POST",vm+"/start","owner",202) and found("GET",vm+"/screenshot","owner",200) and found("DELETE",vm+r"\?deleteDisks=true","owner",202),"Missing real boot or cleanup calls")
        require(found("GET",vm+"/media","foreign",404) and found("PUT",boot,"foreign",404,count),"Missing full-size cross-account denial")
        if mode in ("direct","dual"):
            require(found("PUT",boot,"owner",422,count) and found("PUT",boot,"owner",202,count),"Missing actual digest rejection or import")
        if mode=="resumable":
            require(found("PUT",boot+"/chunks","foreign",404,8*1024*1024) and found("PUT",boot+"/chunks","owner",422,8*1024*1024) and found("POST",boot+"/commit","owner",202),"Missing resumable proof")
        if mode=="dual":
            require(found("PUT",vm+"/media/auxiliary","owner",202),"Missing independent auxiliary import")
        if mode=="url":
            art=r"/media-artifacts/[a-f0-9-]{36}"
            require(found("POST",r"/media-artifacts","owner",202) and found("PUT",art+"/file","foreign",404,count) and found("PUT",art+"/file","owner",422,count) and found("PUT",art+"/file","owner",409,count) and found("PUT",art+"/file","owner",202,count) and found("POST",boot+"/artifact","foreign",404) and found("DELETE",art,"owner",202),"Missing registered-image authorization, integrity or immutability proof")
            imports={x["path"] for x in rows if x["method"]=="POST" and x["status"]==202 and re.fullmatch(boot+"/artifact",x["path"])}
            require(len(imports)==2,"Missing two independent registered-image imports")
        rows_by_mode[mode]=len(rows)
    for name,hit in (("acquisition",False),("cache",True)):
        p=json.loads((root/("public-image-"+name+".json")).read_text())
        require(p=={"authorizedByClient":True,"bytes":PUBLIC_BYTES,"sha256":PUBLIC_SHA,"sourceHost":"download.cirros-cloud.net","cacheHit":hit},"Public source/cache pin mismatch")
    artifact=json.loads((root/"registered-artifact-verification.json").read_text())
    require(artifact["sha256"]==PUBLIC_SHA and artifact["bytes"]==PUBLIC_BYTES,"Registered source pin mismatch")
    require(all(isinstance(artifact[k],str) and re.fullmatch(r"[a-f0-9-]{36}",artifact[k]) for k in ("artifactId","sourcePvcUid","copyPvcUid")) and artifact["sourcePvcUid"]!=artifact["copyPvcUid"],"Missing independent CDI identities")
    require(all(artifact[k] is True for k in ("crossAccountDenied","badDigestDenied","immutable","deletedArtifactIndependentDisks")),"Incomplete registered artifact proof")
    return {"commit":commit,"runId":run_id,"httpCallsByMode":rows_by_mode,"verifiedMediaModes":list(MODES),"hardwareCertifiedByVerifier":False}

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--commit",required=True)
    p.add_argument("--run-id",required=True)
    a=p.parse_args()
    print(json.dumps(verify_media(a.root,a.commit,a.run_id),indent=2))
