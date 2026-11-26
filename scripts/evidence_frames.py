"""Independently decode and OCR the reported frames of an original MP4."""
import re
import subprocess
import tempfile
from pathlib import Path
from cirros_screen import normalize as cirros_normalize


def normalized(text):
    return re.sub(r'[^a-z0-9]', '', text.lower())


def frame_number(name):
    match = re.fullmatch(r'frame-([0-9]{5})\.png', name)
    if not match or not 1 <= int(match[1]) <= 240:
        raise ValueError('Invalid frame reference')
    return int(match[1]) - 1


def pixels(path):
    # Fixed output dimensions are the recording worker contract. Pixel compare
    # tolerates PNG compression differences across ffmpeg versions.
    return subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-frames:v', '1',
        '-vf', 'scale=1280:720', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
    ], timeout=30)


def decoded_frame(raw, index, dest):
    subprocess.run([
        'ffmpeg', '-v', 'error', '-i', str(raw), '-vf', f'fps=2,select=eq(n\\,{index})',
        '-fps_mode', 'passthrough', '-frames:v', '1', '-c:v', 'png', str(dest)
    ], check=True, timeout=60)
    if not dest.is_file():
        raise ValueError('Referenced video frame does not exist')


def ocr(path, cirros=False):
    text=subprocess.check_output([
        'tesseract', str(path), 'stdout', '--psm', '6', '--dpi', '180'
    ], stderr=subprocess.DEVNULL, timeout=15, text=True)
    return cirros_normalize(text) if cirros else normalized(text)


def verify_marker_frames(raw, folder, meta, profile):
    first, last = frame_number(meta['firstFrame']), frame_number(meta['finalFrame'])
    if first >= last:
        raise ValueError('Reported markers are not in chronological order')
    markers = meta['markers']
    before, after = markers['before'], markers['after']
    if any(not isinstance(x, str) or normalized(x) != x or not 1 <= len(x) <= 100 for x in (before, after)) or before == after:
        raise ValueError('Invalid marker declaration')
    if profile == 'control' and (before, after) != ('scriptstart', 'scriptdone'):
        raise ValueError('Incorrect control markers')
    if profile == 'functional' and (before, after) != ('proofready', 'proofcomplete'):
        raise ValueError('Incorrect functional markers')
    if profile == 'android' and 'apkcompletearm64v8a' not in after:
        raise ValueError('Missing Android ARM64 marker')
    if profile == 'windows' and not any(x in after for x in ('7zip', 'proof7z')):
        raise ValueError('Missing Windows application marker')
    with tempfile.TemporaryDirectory() as tmp:
        for index, name, expected in [(first,'video-first-marker.png',before),(last,'video-final-marker.png',after)]:
            path = Path(tmp)/name
            decoded_frame(raw,index,path)
            if pixels(path) != pixels(folder/name):
                raise ValueError('Marker frame does not match original video')
            text = ocr(path,profile=='control')
            if text.count(expected) != 1 or (index == first and after in text):
                raise ValueError('Required unique marker absent or out of order')
    return {'independentlyDecodedMarkerFrames': True, 'before': before, 'after': after}
