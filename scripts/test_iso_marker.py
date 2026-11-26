import unittest
from iso_marker import parse_pgm,crop_for_ocr,exact_marker
class IsoMarkerTests(unittest.TestCase):
    def test_exact_and_not_fuzzy(self):
        self.assertTrue(exact_marker("VM INTERFACE ISOBOOTOK"))
        self.assertFalse(exact_marker("WMINTERFACE ISOBOOTOK"))
        self.assertFalse(exact_marker("VMINTERFACE ISOBOOTOR"))
    def test_real_pixel_transform(self):
        w,h,pixels=parse_pgm(b"P5\n3 2\n255\n"+bytes([0,0,0,0,255,0]))
        cw,ch,scaled=parse_pgm(crop_for_ocr(w,h,pixels))
        self.assertEqual((cw,ch),(45,45))
        self.assertEqual(scaled[20*cw+20:20*cw+25],bytes(5))
        self.assertEqual(scaled[:cw],b"\xff"*cw)
        self.assertIsNone(crop_for_ocr(2,2,bytes(4)))
        with self.assertRaises(ValueError):parse_pgm(b"P5\n3 2\n255\n"+bytes(5))
