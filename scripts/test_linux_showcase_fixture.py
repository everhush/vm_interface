import unittest, io, zipfile
from linux_showcase_fixture import package, verify_archive, digest
class LinuxFixtureTests(unittest.TestCase):
    def test_reproducible_software_package(self):
        self.assertEqual(package(),package())
        with zipfile.ZipFile(io.BytesIO(package())) as z:
            self.assertEqual(z.namelist(),["proof.py"])
            compile(z.read("proof.py"),"proof.py","exec")
    def test_archive_exact_bytes(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,"w") as z:
            z.writestr("challenge.bin",b"actual")
        verify_archive(stream.getvalue(),b"actual")
        with self.assertRaises(ValueError):verify_archive(stream.getvalue(),b"wrong")

    def test_guest_inventory_requires_exact_architecture_version_and_license_fields(self):
        import json
        from linux_showcase_fixture import verify_platform
        platform=json.dumps({"machine":"x86_64","release":"ID=fedora\nVERSION_ID=44\n"}).encode()
        rpm=b"fedora-release\t44-1\tMIT\n"
        verify_platform(platform,rpm,"44")
        with self.assertRaises(ValueError):verify_platform(platform,rpm,"43")
        with self.assertRaises(ValueError):verify_platform(platform,b"fedora-release\t44-1\n","44")
