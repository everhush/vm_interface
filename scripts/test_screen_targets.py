import unittest
from screen_targets import parse_target
HEADER="level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
ROW="5\t1\t1\t1\t1\t1\t10\t20\t40\t20\t95\tCompute\n5\t1\t1\t1\t1\t2\t55\t20\t30\t20\t95\tproof\n"
class TargetTests(unittest.TestCase):
    def test_unique_exact_label(self):
        self.assertEqual(parse_target(HEADER+ROW,"Compute proof",100,100),(47,30))
        self.assertIsNone(parse_target(HEADER+ROW,"Compute",100,100))
    def test_duplicate_low_confidence_and_outside(self):
        self.assertIsNone(parse_target(HEADER+ROW+ROW.replace("5\t1\t1\t","5\t1\t2\t"),"Compute proof",100,100))
        self.assertIsNone(parse_target(HEADER+ROW.replace("95","10"),"Compute proof",100,100))
        with self.assertRaises(ValueError):
            parse_target(HEADER+ROW,"Compute proof",60,100)
