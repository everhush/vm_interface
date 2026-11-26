import unittest
from cirros_screen import normalize,ready

class CirrosScreenTests(unittest.TestCase):
    def test_actual_ocr_interleave(self):
        observed="cirros login: autocitesthumanl  65.731613] random: nonblocking pool is initial\nzed\n\ncontrol_"
        self.assertEqual(normalize(observed),"cirrosloginautocitesthumancontrol")
        self.assertIn("forbiddeninput",normalize(observed+"forbiddeninput"))
        self.assertNotIn("humancontrol",normalize("human[65.731613] random: forbiddeninput control"))
    def test_optional_entropy_and_real_prompt(self):
        self.assertFalse(ready("cirros login:",89.99))
        self.assertTrue(ready("cirros login:",90))
        self.assertTrue(ready("cirros login:\n[65.731613] random: nonblocking pool is initialized",1))
        self.assertFalse(ready("booting",120))
