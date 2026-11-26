import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from verify_network_evidence import verify

class NetworkEvidenceTests(unittest.TestCase):
    def fixture(self,root):
        # Synthetic unit fixture only; never published as native guest proof.
        vm="/computers/vm-"+"a"*32
        grant=vm+"/exposures/"+"b"*36
        marker="network-marker-"+"c"*36
        body=(marker+"\ncluster-egress-blocked\n").encode()
        raw=b"HTTP/1.0 200 OK\r\nContent-Length: "+str(len(body)).encode()+b"\r\n\r\n"+body
        for name in ("guest","relay"):(root/("network-"+name+"-response.txt")).write_bytes(raw)
        rows=[]
        def row(method,path,status,actor=None,phase=None,expected=None):
            x=dict(method=method,path=path,status=status,expected=status if expected is None else expected)
            if actor:x["actor"]=actor
            if phase:x["phase"]=phase
            rows.append(x)
        row("POST",vm+"/exposures",404,"foreign")
        row("POST",vm+"/exposures",422,"owner")
        row("POST",vm+"/exposures",201,"owner")
        row("WSS",grant+"/connect",502,phase="ready",expected=101)
        for code in (401,401,101,409,401):row("WSS",grant+"/connect",code)
        row("DELETE",grant,200,"owner")
        row("POST",vm+"/stop",202,"owner")
        row("DELETE",vm+"?deleteDisks=true",202,"owner")
        row("GET","/operations/"+"d"*36,200,"owner")
        trace=b"".join((json.dumps(x)+"\n").encode() for x in rows)
        (root/"network-http.jsonl").write_bytes(trace)
        p={k:True for k in ("nativeGuestHttp","loopbackTcpRelayVerified","clusterApiEgressBlocked","crossAccountDenied","duplicateConnectionDenied","revokedDisconnect","stopDisconnect")}
        p.update(commit="a"*40,runId="123",marker=marker,guestResponseSha256=hashlib.sha256(raw).hexdigest(),relayResponseSha256=hashlib.sha256(raw).hexdigest(),traceSha256=hashlib.sha256(trace).hexdigest())
        (root/"network-verification.json").write_text(json.dumps(p))
    def test_complete_and_tampered_trace(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.fixture(root)
            self.assertTrue(verify(root,"a"*40,"123")["guestAndRelayResponseVerified"])
            with (root/"network-http.jsonl").open("a") as f:f.write("{}\n")
            with self.assertRaisesRegex(ValueError,"trace hash"):verify(root,"a"*40,"123")
    def test_tampered_response(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.fixture(root)
            (root/"network-relay-response.txt").write_text("not guest evidence")
            with self.assertRaisesRegex(ValueError,"response hash"):verify(root,"a"*40,"123")
