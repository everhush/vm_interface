import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from verify_media_evidence import verify_media,OCI_SHA,OCI_BYTES

class MediaEvidenceTests(unittest.TestCase):
    def test_incomplete_artifact_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError):
                verify_media(Path(d),"a"*40,"123")
    def test_mixed_commit_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/"media-direct-verification.json").write_text(json.dumps({"commit":"b"*40,"runId":"123","mode":"direct"}))
            with self.assertRaisesRegex(ValueError,"Wrong media execution"):
                verify_media(root,"a"*40,"123")
    def test_reported_success_cannot_substitute_missing_screenshot(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            proof=dict(commit="a"*40,runId="123",mode="direct",sha256=OCI_SHA,bytes=OCI_BYTES,
                       verifiedCDI=True,badDigestDenied=True,crossAccountDenied=True,idempotent=True,
                       guestLoginVerified=True,screenshotSha256="a"*64)
            (root/"media-direct-verification.json").write_text(json.dumps(proof))
            with self.assertRaises(FileNotFoundError):
                verify_media(root,"a"*40,"123")
    def test_wrong_trace_status_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            png=root/"imported-disk-direct-display.png";png.write_bytes(b"unit fixture")
            trace=root/"media-direct-http.jsonl";trace.write_text(json.dumps(dict(method="PUT",path="/computers/vm-"+"a"*32+"/media/boot",actor="foreign",status=202,expected=404)))
            proof=dict(commit="a"*40,runId="123",mode="direct",sha256=OCI_SHA,bytes=OCI_BYTES,
                       verifiedCDI=True,badDigestDenied=True,crossAccountDenied=True,idempotent=True,
                       guestLoginVerified=True,screenshotSha256=hashlib.sha256(png.read_bytes()).hexdigest(),
                       traceSha256=hashlib.sha256(trace.read_bytes()).hexdigest())
            (root/"media-direct-verification.json").write_text(json.dumps(proof))
            with self.assertRaisesRegex(ValueError,"Failed or invalid HTTP trace"):
                verify_media(root,"a"*40,"123",screen_ocr=lambda p:"cirroslogin")
