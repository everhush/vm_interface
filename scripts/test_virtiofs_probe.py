import hashlib
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("probe-virtiofs-ci.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class VirtiofsProbeTests(unittest.TestCase):
    def test_expected_response(self):
        challenge = "example"
        digest = hashlib.sha256(challenge.encode()).hexdigest()
        raw = f"sha256={digest}\nfilesystem=virtiofs\nkernel=6.12\nvirtio_mem_driver=present\n"
        self.assertEqual(probe.verify_response(raw, challenge)["sha256"], digest)
        with self.assertRaises(AssertionError):
            probe.verify_response(raw, "different")
        with self.assertRaises(AssertionError):
            probe.verify_response(raw.replace("filesystem=virtiofs", "filesystem=ext4"), challenge)

    def test_only_pvc_and_no_guest_network(self):
        pvc, pod, vmi = probe.objects("fedora@sha256:abc", "busybox@sha256:def")
        self.assertEqual(pvc["spec"]["volumeMode"], "Filesystem")
        self.assertFalse(pod["spec"]["automountServiceAccountToken"])
        self.assertEqual(pod["spec"]["securityContext"]["runAsUser"], 107)
        self.assertFalse(vmi["spec"]["domain"]["devices"]["autoattachPodInterface"])
        self.assertEqual(vmi["spec"]["domain"]["devices"]["filesystems"], [{"name": "exchange", "virtiofs": {}}])
        self.assertEqual(vmi["spec"]["volumes"][-1]["persistentVolumeClaim"]["claimName"], "exchange")
        self.assertNotIn("hostPath", str(vmi))
