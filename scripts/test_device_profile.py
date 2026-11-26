import unittest
from pathlib import Path
from device_profile import namespace, deployment, verify_deployment, verify_pvc

class DeviceProfile(unittest.TestCase):
    def test_only_stage_claim_changes(self):
        source = (Path(__file__).resolve().parents[1] / "infra/namespace.yaml").read_text()
        self.assertEqual(namespace(source, "core"), source)
        self.assertEqual(namespace(source, "android"), source.replace("requests: {storage: 512Mi}", "requests: {storage: 20Gi}"))
        with self.assertRaises(ValueError):
            namespace(source.replace("512Mi", "1Gi"), "android")
    def test_both_containers_configured(self):
        for profile in ("android", "windows"):
            patch = deployment(profile)
            verify_deployment(patch, profile)
            patch["spec"]["template"]["spec"]["containers"].pop()
            with self.assertRaises(KeyError):
                verify_deployment(patch, profile)
    def test_capacity(self):
        claim = {"metadata": {"name": "vm-media-stage"}, "spec": {"resources": {"requests": {"storage": "20Gi"}}}}
        verify_pvc(claim, "android")
        with self.assertRaises(ValueError):
            verify_pvc(claim, "core")
