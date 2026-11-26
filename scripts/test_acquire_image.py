import hashlib
import io
import os
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from acquire_image import acquire, allowed_url, checked_stream, public_address, resolve_public

HOST = "download.example.com"
URL = "https://" + HOST + "/image"
DATA = b"q" * 4096
DIGEST = hashlib.sha256(DATA).hexdigest()


class AcquisitionTests(unittest.TestCase):
    def test_url_and_address_validation(self):
        self.assertEqual(allowed_url(URL, {HOST}).hostname, HOST)
        for url in ("http://" + HOST, "https://user@" + HOST,
                    "https://" + HOST + ":444", "https://127.0.0.1/a",
                    "https://" + HOST + ".evil/a", "https://" + HOST + "/#x",
                    "https://" + HOST + "/a\\b", "https://" + HOST + "/a\nb"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                allowed_url(url, {HOST, "127.0.0.1"})
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1",
                   "192.0.2.1", "224.0.0.1", "::1", "::ffff:8.8.8.8",
                   "64:ff9b::a00:1", "2002:0a00:0001::", "fe80::1"):
            with self.subTest(ip=ip), self.assertRaises(ValueError):
                public_address(ip)
        self.assertEqual(public_address("8.8.8.8"), "8.8.8.8")

    def test_mixed_dns_answers_fail_closed(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)),
                   (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch("acquire_image.socket.getaddrinfo", return_value=answers):
            with self.assertRaises(ValueError):
                resolve_public(HOST)

    def test_digest_length_and_size_limits(self):
        self.assertEqual(checked_stream(io.BytesIO(DATA), io.BytesIO(), DIGEST, 4096, 4096), 4096)
        for sha, bound, size in (("0"*64, 4096, 4096), (DIGEST, 1024, None), (DIGEST, 4096, 2048)):
            with self.assertRaises(ValueError):
                checked_stream(io.BytesIO(DATA), io.BytesIO(), sha, bound, size)

    def test_cache_revalidates_and_outputs_are_independent(self):
        def fake(url, hosts, out, sha, limit, size, timeout):
            return checked_stream(io.BytesIO(DATA), out, sha, limit, size)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            with patch("acquire_image.download", side_effect=fake) as downloader:
                one = root / "one"
                two = root / "two"
                self.assertFalse(acquire(URL, one, DIGEST, {HOST}, 4096, 4096, cache)["cacheHit"])
                one.write_bytes(b"modified")
                self.assertTrue(acquire(URL, two, DIGEST, {HOST}, 4096, 4096, cache)["cacheHit"])
                self.assertEqual(two.read_bytes(), DATA)
                self.assertEqual(downloader.call_count, 1)
                self.assertNotEqual(os.stat(two).st_ino, os.stat(cache / DIGEST).st_ino)
                with self.assertRaises(FileExistsError):
                    acquire(URL, two, DIGEST, {HOST}, 4096, 4096, cache)
                (cache / DIGEST).chmod(0o600)
                (cache / DIGEST).write_bytes(b"x" * 4096)
                with self.assertRaises(ValueError):
                    acquire(URL, root / "three", DIGEST, {HOST}, 4096, 4096, cache)
                self.assertFalse((root / "three").exists())
                (cache / DIGEST).unlink()
                (cache / DIGEST).symlink_to(two)
                with self.assertRaises(OSError):
                    acquire(URL, root / "four", DIGEST, {HOST}, 4096, 4096, cache)
                self.assertFalse((root / "four").exists())


if __name__ == "__main__":
    unittest.main()
