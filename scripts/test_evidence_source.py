import runpy
import unittest
from pathlib import Path
v=runpy.run_path(str(Path(__file__).with_name("verify-evidence.py")))
class EvidenceSourceIdentity(unittest.TestCase):
    def test_exact_identity(self):
        fn=v["source_identity"]
        commit="a"*40
        self.assertEqual(fn({"commit":commit,"runId":"12345"},commit),(commit,"12345"))
        self.assertEqual(fn({"commit":commit,"runId":"device-20261126T100000Z-12"}),(commit,"device-20261126T100000Z-12"))
        for proof in ({},{"commit":"short","runId":"123"},{"commit":commit,"runId":"unbound"},{"commit":"b"*40,"runId":"123"}):
            with self.assertRaises(ValueError):fn(proof,commit)
