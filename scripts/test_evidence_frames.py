import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from evidence_frames import frame_number, normalized, decoded_frame, verify_marker_frames


class EvidenceFrameTests(unittest.TestCase):
    def test_frame_reference_bounds(self):
        self.assertEqual(frame_number('frame-00001.png'),0)
        self.assertEqual(frame_number('frame-00240.png'),239)
        for value in ['frame-00000.png','frame-00241.png','../frame-00001.png','frame-1.png']:
            with self.assertRaises(ValueError):
                frame_number(value)
        self.assertEqual(normalized('APKCOMPLETE arm64-v8a'),'apkcompletearm64v8a')

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('tesseract'),'requires local video/OCR tools')
    def test_original_pixels_and_order(self):
        # Deliberately synthetic fixture ONLY for the independent verifier unit test.
        # Never upload this file as product/guest evidence.
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            raw=folder/'fixture.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=black:s=1280x720:r=2:d=2',
                '-vf',"drawtext=text=scriptstart:fontcolor=white:fontsize=80:x=100:y=100:enable='lt(t,1)',drawtext=text=scriptdone:fontcolor=white:fontsize=80:x=100:y=100:enable='gte(t,1)'",'-c:v','libx264','-pix_fmt','yuv420p',str(raw)],check=True,timeout=30)
            first,last=folder/'video-first-marker.png',folder/'video-final-marker.png'
            decoded_frame(raw,0,first)
            decoded_frame(raw,2,last)
            meta={'firstFrame':'frame-00001.png','finalFrame':'frame-00003.png','markers':{'before':'scriptstart','after':'scriptdone'}}
            self.assertTrue(verify_marker_frames(raw,folder,meta,'control')['independentlyDecodedMarkerFrames'])
            last.write_bytes(first.read_bytes())
            with self.assertRaisesRegex(ValueError,'does not match'):
                verify_marker_frames(raw,folder,meta,'control')
            with self.assertRaisesRegex(ValueError,'chronological'):
                verify_marker_frames(raw,folder,{**meta,'firstFrame':'frame-00004.png'},'control')

if __name__=='__main__':
    unittest.main()
