import hashlib
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path
from prepare_android import prepare, qcow_capacity


def header(backing=0):
    data = bytearray(104)
    data[:4] = b'QFI\xfb'
    struct.pack_into('>I',data,4,3)
    struct.pack_into('>Q',data,8,backing)
    struct.pack_into('>Q',data,24,1024**3)
    return bytes(data)


class PrepareTest(unittest.TestCase):
    def fixture(self, root, extra=None):
        archive = root/'test.zip'
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('fixture.utm/Data/vda.qcow2',header())
            z.writestr('fixture.utm/Data/vdb.qcow2',header())
            if extra:
                z.writestr(extra,header())
        return archive, hashlib.sha256(archive.read_bytes()).hexdigest()

    def test_exact_two_disks_and_no_other_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive, sha = self.fixture(root, 'fixture.utm/config.plist')
            checked = []
            out = root/'prepared'
            result = prepare(archive,sha,out,lambda path,size:checked.append((path.name,size)))
            self.assertEqual(set(result),{'vda.qcow2','vdb.qcow2'})
            self.assertEqual(set(p.name for p in out.iterdir()),{'vda.qcow2','vdb.qcow2','disks.json'})
            self.assertEqual(len(checked),2)
            self.assertEqual(result['vda.qcow2']['sizeGiB'],2)
            with self.assertRaisesRegex(ValueError,'already exists'):
                prepare(archive,sha,out,lambda *_:None)

    def test_reject_digest_traversal_duplicate_and_backing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            archive,sha=self.fixture(root,'../outside')
            with self.assertRaisesRegex(ValueError,'digest'):
                prepare(archive,'0'*64,root/'out',lambda *_:None)
            with self.assertRaisesRegex(ValueError,'Unsafe'):
                prepare(archive,sha,root/'out',lambda *_:None)
            self.assertFalse((root/'out').exists())
            archive,sha=self.fixture(root,'other.utm/Data/vda.qcow2')
            with self.assertRaisesRegex(ValueError,'duplicate'):
                prepare(archive,sha,root/'out',lambda *_:None)
            with self.assertRaisesRegex(ValueError,'backing'):
                qcow_capacity(header(100))


if __name__ == '__main__':
    unittest.main()
