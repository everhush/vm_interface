import io
import json
import tarfile
import unittest
from android_guest_transfer import verify_staged_bundle,digest,device_state,require_guest_security

class AndroidGuestTransfer(unittest.TestCase):
    def bundle(self, data, extra=False):
        buf=io.BytesIO()
        with tarfile.open(fileobj=buf,mode="w",format=tarfile.USTAR_FORMAT) as t:
            rows=[{"name":"upload/"+n,"bytes":len(b),"sha256":digest(b),"direction":"upload"} for n,b in data.items()]
            members={"upload/"+n:b for n,b in data.items()}
            members["manifest.json"]=json.dumps({"version":1,"scope":"published-exchange-files-only","files":rows}).encode()
            if extra:members["../escape"]=b"x"
            for n,b in members.items():
                info=tarfile.TarInfo(n);info.size=len(b);t.addfile(info,io.BytesIO(b))
        return buf.getvalue()
    def test_exact_actual_bundle_and_reject_extra(self):
        expected={"proof.apk":b"apk","challenge.bin":b"random"}
        self.assertEqual(verify_staged_bundle(self.bundle(expected),expected),expected)
        with self.assertRaises(ValueError):
            verify_staged_bundle(self.bundle(expected,True),expected)
        with self.assertRaises(ValueError):
            verify_staged_bundle(self.bundle({**expected,"proof.apk":b"bad"}),expected)
    def test_fresh_key_and_guest_security(self):
        serial="127.0.0.1:1234"
        self.assertEqual(device_state(b"List of devices attached\n127.0.0.1:1234\tunauthorized\n",serial),"unauthorized")
        with self.assertRaises(ValueError):
            device_state(b"List of devices attached\nUSB\tdevice\n",serial)
        require_guest_security("1","Enforcing","2000","arm64-v8a")
        for bad in [("0","Enforcing","2000","arm64-v8a"),("1","Permissive","2000","arm64-v8a"),("1","Enforcing","0","arm64-v8a"),("1","Enforcing","2000","x86_64")]:
            with self.assertRaises(ValueError):
                require_guest_security(*bad)
