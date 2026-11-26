import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from provision_sources import load, verify, COMMON, ARCH

class ProvisionSources(unittest.TestCase):
    def test_architectures_and_exact_manifest(self):
        m = json.loads((Path(__file__).resolve().parents[1]/"infra/provision-sources.json").read_text())
        for arch, binary in ARCH.items():
            self.assertEqual({r["name"] for r in load(m, arch)}, COMMON | {binary})
        m["assets"][0]["url"] = "http://example.invalid/install.sh"
        with self.assertRaises(ValueError):
            load(m, "aarch64")
    def test_reject_tampered_file(self):
        original = b"trusted"
        row = {"name": "install.sh", "bytes": len(original), "sha256": hashlib.sha256(original).hexdigest()}
        with tempfile.TemporaryDirectory() as root:
            p = Path(root)/"install.sh"
            p.write_bytes(original)
            verify(p, row)
            p.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                verify(p, row)
