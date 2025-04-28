#!/usr/bin/env python3
"""Verify existing evidence; never generate or substitute guest recordings."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from evidence_frames import verify_marker_frames


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


def verify_recording(folder, proof):
    meta = proof['recording']
    raw = folder / 'platform-recording.mp4'
    check(raw.is_file(), 'Missing original platform recording')
    check(raw.stat().st_size > 0, 'Empty recording')
    check(file_hash(raw) == meta['sha256'], 'Recording SHA256 mismatch')
    if 'bytes' in meta:
        check(raw.stat().st_size == meta['bytes'], 'Recording length mismatch')
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(raw)
    ], timeout=30))
    check(len(probe['streams']) == 1 and probe['streams'][0]['codec_name'] == 'h264', 'Unexpected recording format')
    check(float(probe['format']['duration']) > 0, 'Invalid video duration')
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(raw), '-f', 'null', '-'], check=True, timeout=120)
    check(meta.get('fullDecode') is True, 'Original verification did not report full decode')
    check((folder/'video-first-marker.png').is_file() and (folder/'video-final-marker.png').is_file(), 'Missing decoded marker frames')
    return {'sha256': file_hash(raw), 'durationSeconds': float(probe['format']['duration']), 'bytes': raw.stat().st_size}


def verify_folder(folder, profile):
    proof = json.loads((folder/'verification.json').read_text())
    video = verify_recording(folder, proof)
    video.update(verify_marker_frames(folder/"platform-recording.mp4",folder,proof["recording"],profile))
    trace = folder/'http-trace.jsonl'
    rows = [json.loads(line) for line in trace.read_text().splitlines() if line]
    check(rows and all(row['status'] == row['expected'] for row in rows), 'Missing or failed HTTP trace')
    check(all(set(row) <= {'elapsedMs','method','path','status','expected','responseMs','phase'} for row in rows), 'Unexpected trace fields')
    phases = {row.get('phase') for row in rows}
    check({'create','start','record start','record stop','retrieve MP4','stop'} <= phases, 'Incomplete lifecycle trace')
    if profile == 'control':
        check(proof['actualGuestBootScreen'] and proof['automationLease'] and proof['idempotentReplay'], 'Missing control assertions')
        check(proof['crossAccountDenied'] and proof['keyRevoked'] and proof['stoppedAndDeleted'], 'Missing lifecycle/isolation assertions')
        check(file_hash(trace) == proof['trace']['sha256'], 'Trace checksum mismatch')
        check({'first input','second input','idempotent replay'} <= phases, 'Missing HTTP control calls')
    elif profile == 'functional':
        check(proof['guestComputedResult'] and proof['actualGuestVisibleResult'] and proof['stoppedOutputPersistent'], 'Missing guest result assertions')
        check(file_hash(trace) == proof['traceSha256'], 'Trace checksum mismatch')
        check(file_hash(folder/'guest-result.bin') == proof['outputSha256'], 'Output hash mismatch')
        check({'upload file','download file','guest action'} <= phases, 'Missing functional API calls')
    else:
        check(proof['profile'] == profile and proof['architecture'] == ('amd64' if profile == 'windows' else 'arm64'), 'Wrong showcase profile')
        check(proof['screenMarkersVerified'] and proof['coldResizeAndFilePersistence'], 'Missing showcase assertions')
        expected = (b'VM Interface Windows 7-Zip functional proof\n' if profile == 'windows'
                    else b'VM Interface Android APK functional proof\n')
        check((folder/'guest-result.bin').read_bytes() == expected, 'Unexpected native result bytes')
        check(file_hash(folder/'guest-result.bin') == proof['outputSha256'], 'Output hash mismatch')
        check(file_hash(trace) == proof['traceSha256'], 'Trace checksum mismatch')
        check({'upload file','download file','guest action'} <= phases, 'Missing native application API calls')
    return {'profile': profile, 'video': video, 'httpCalls': len(rows), 'scope': 'artifact-integrity-independent-marker-decode-and-reported-assertions'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--profile', choices=['core','windows','android','all'], required=True)
    a = p.parse_args()
    folders = {'control': 'api-control-proof', 'functional': 'api-functional-proof',
               'windows': 'showcase-windows', 'android': 'showcase-android'}
    targets = ['control','functional'] if a.profile == 'core' else list(folders) if a.profile == 'all' else [a.profile]
    report = {'passed': [], 'failed': [], 'hardwareCertifiedByVerifier': False}
    for target in targets:
        try:
            report['passed'].append(verify_folder(a.root/folders[target], target))
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
            report['failed'].append({'profile': target, 'error': str(exc)})
    print(json.dumps(report, indent=2))
    raise SystemExit(bool(report['failed']))
