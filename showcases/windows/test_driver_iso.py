import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('driver_iso', Path(__file__).with_name('build-driver-iso.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class DriverMediaTests(unittest.TestCase):
    def test_pins_exact_bytes_and_signer(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, dest = Path(tmp)/'source.msi', Path(tmp)/'staged.msi'
            data = m.MSI_MAGIC + b'fixture'
            source.write_bytes(data)
            sha = hashlib.sha256(data).hexdigest()
            self.assertEqual(m.stage_package(source, dest, sha, 'a'*40),
                             {'name':'staged.msi','bytes':len(data),'sha256':sha,'signerThumbprint':'A'*40})
            self.assertEqual(dest.read_bytes(), data)

    def test_rejects_wrong_digest_non_msi_and_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root/'source.msi'
            source.write_bytes(m.MSI_MAGIC+b'fixture')
            with self.assertRaisesRegex(ValueError,'SHA256 mismatch'):
                m.stage_package(source, root/'wrong.msi', '0'*64, 'a'*40)
            source.write_bytes(b'not an MSI')
            with self.assertRaisesRegex(ValueError,'header'):
                m.stage_package(source, root/'header.msi', '0'*64, 'a'*40)
            link = root/'link.msi'
            link.symlink_to(source)
            with self.assertRaisesRegex(ValueError,'regular'):
                m.stage_package(link, root/'linked.msi', '0'*64, 'a'*40)

if __name__ == '__main__':
    unittest.main()
