import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from showcase_inputs import load_scenario
from android_fixture import ANDROID_RESULT_MODE,android_result

class ShowcaseInputsTest(unittest.TestCase):
    def check(self, profile, scenario):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "scenario.json"
            path.write_text(json.dumps(scenario))
            return load_scenario(path, profile)

    def fixture(self, profile):
        result = b"VM Interface Windows 7-Zip functional proof\n" if profile == "windows" else b"VM Interface Android APK functional proof\n"
        return {"setup":[{"system-boot":True}] if profile=="windows" else [{"wait":{"text":"Ready","seconds":5}}],
                "softwareSetup":[{"human":"Install uploaded fixture and select authorized exchange directory"}] if profile=="android" else [],
                "application":[{"click":[12,34]},{"wait":{"text":"Done","seconds":10}}],
                "beforeMarker":"Ready","afterMarker":"7-Zip" if profile=="windows" else "APK COMPLETE arm64-v8a",
                "resultName":"result.txt","expectedResultSha256":hashlib.sha256(result).hexdigest() if profile=="windows" else ANDROID_RESULT_MODE}

    def test_accepts_structural_fixtures(self):
        for profile in ("windows","android"):
            sample=self.fixture(profile)
            self.assertEqual(self.check(profile,sample),sample)

    def test_rejects_unsafe_or_incomplete(self):
        for steps in ([{"human":"password"}],[{"delay":60},{"wait":{"text":"Done","seconds":60}}],[{"click":[True,2]}],[],[{"unknown":1}]):
            sample=self.fixture("android")
            sample["application"]=steps
            with self.assertRaises(ValueError):
                self.check("android",sample)

    def test_rejects_wrong_native_profile_or_digest(self):
        sample=self.fixture("windows")
        sample["setup"]=[{"delay":1}]
        with self.assertRaises(ValueError):
            self.check("windows",sample)
        sample=self.fixture("android")
        sample["expectedResultSha256"]="0"*64
        with self.assertRaises(ValueError):
            self.check("android",sample)

    def test_android_output_is_bound_to_exact_random_input(self):
        a,b=bytes(4096),bytes([1])*4096
        self.assertNotEqual(android_result(a),android_result(b))
        self.assertIn(hashlib.sha256(a).hexdigest().encode(),android_result(a))
        with self.assertRaises(ValueError):android_result(a[:-1])
