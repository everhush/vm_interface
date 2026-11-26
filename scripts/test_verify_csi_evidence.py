import unittest
from verify_csi_evidence import capacity,digest,require

class EvidenceValues(unittest.TestCase):
    def test_quantities(self):
        self.assertEqual(capacity("8Gi"),8*1024**3)
        self.assertEqual(capacity("6828998001"),6828998001)
        with self.assertRaises(ValueError):capacity("8GiB")
    def test_failure_and_digest(self):
        self.assertNotEqual(digest(b"original"),digest(b"tampered"))
        with self.assertRaisesRegex(ValueError,"identity"):require(False,"PVC identity changed")
