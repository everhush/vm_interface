"""Regression guard for corrupted admission manifest (not CEL runtime validation)."""
import unittest
from pathlib import Path
class AdmissionPolicyTests(unittest.TestCase):
    def test_data_disk_policy_is_single_complete_document_pair(self):
        raw=(Path(__file__).resolve().parents[1]/"infra/exchange-policy.yaml").read_text()
        docs=raw.split("\n---\n")
        disk=[x for x in docs if "\n  name: vm-data-disk\n" in x]
        self.assertEqual(len(disk),2)
        self.assertEqual(sum("kind: ValidatingAdmissionPolicy\n" in x for x in disk),1)
        self.assertEqual(sum("kind: ValidatingAdmissionPolicyBinding\n" in x for x in disk),1)
        self.assertIn("[a-z0-9])?$')))",disk[0])
        self.assertIn("!has(object.spec.sourceRef)",disk[0])
        self.assertIn("object.spec.source.pvc.namespace == request.namespace",disk[0])
        self.assertTrue(disk[1].endswith("  validationActions: [Deny]\n"))
