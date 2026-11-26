#!/usr/bin/env python3
"""Verify existing evidence; never generate or substitute guest recordings."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from evidence_frames import verify_marker_frames, ocr
from android_fixture import ANDROID_RESULT_MODE,android_result
from showcase_inputs import load_scenario
from android_guest_transfer import verify_staged_bundle
from linux_showcase_fixture import package, verify_archive, verify_platform, verify_pointer_receipt


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


def source_identity(proof, expected_commit=None):
    commit=proof.get("commit")
    run=proof.get("runId")
    check(isinstance(commit,str) and re.fullmatch(r"[a-f0-9]{40}",commit),"Missing exact source commit")
    check(isinstance(run,str) and re.fullmatch(r"(?:[0-9]+|device-[0-9]{8}T[0-9]{6}Z-[0-9]+)",run),"Missing exact hosted or disposable-device run identity")
    if expected_commit is not None:
        check(commit==expected_commit,"Evidence source commit differs from approved candidate")
    return commit,run

def verify_folder(folder, profile, expected_commit=None):
    proof = json.loads((folder/'verification.json').read_text())
    commit,run=source_identity(proof,expected_commit)
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
        check({'upload file','download file','guest action','upload software','download archive','cold resize','restart after resize'} <= phases, 'Missing Linux application API calls')
        check(proof['profile']=='linux' and proof['architecture']=='amd64' and proof['softwareInstalled'] and proof['coldResizeAndFilePersistence'], 'Missing Linux installation and persistence evidence')
        check((folder/'software.zip').read_bytes()==package() and file_hash(folder/'software.zip')==proof['softwareSha256'], 'Software package mismatch')
        challenge=(folder/'challenge.bin').read_bytes()
        check(file_hash(folder/'challenge.bin')==proof['inputSha256'] and len(challenge)==proof['inputBytes'], 'Challenge mismatch')
        check((folder/'guest-result.bin').read_bytes()==b'guest-result:'+hashlib.sha256(challenge).hexdigest().encode('ascii')+b'\n', 'Wrong guest result')
        check(proof['guestPointerProof'] is True and file_hash(folder/'pointer-receipt.json')==proof['pointerReceiptSha256'],'Missing guest tablet receipt')
        verify_pointer_receipt((folder/'pointer-receipt.json').read_bytes(),challenge)
        check(file_hash(folder/'pointer-ready.png')==proof['pointerReadyScreenshotSha256'] and 'pointerready' in ocr(folder/'pointer-ready.png'),'Missing visible pointer readiness')
        check(file_hash(folder/'after.png')==proof['pointerDoneScreenshotSha256'] and 'pointerdone' in ocr(folder/'after.png'),'Missing visible pointer completion')
        check({'observer pointer denied','outside pointer denied','guest pointer action','pointer replay'}<=phases,'Missing pointer API authorization and replay evidence')
        verify_archive((folder/'guest-archive.zip').read_bytes(),challenge)
        check(file_hash(folder/'guest-archive.zip')==proof['archiveSha256'], 'Guest archive hash mismatch')
        check(proof['guestDiskCloneByteProof'] and proof['clonePvcUid'] not in proof['originalPvcUids'].values(), 'Missing distinct data disk clone evidence')
        check((folder/'disk-original.bin').read_bytes()==challenge and (folder/'disk-original-after.bin').read_bytes()==challenge and (folder/'disk-clone-after.bin').read_bytes()==bytes(x^255 for x in challenge), 'Guest disk clone byte proof mismatch')
        check(file_hash(folder/'guest-platform.json')==proof['guestPlatformSha256'] and file_hash(folder/'guest-rpm.tsv')==proof['guestRpmSha256'], 'Guest media provenance mismatch')
        verify_platform((folder/'guest-platform.json').read_bytes(),(folder/'guest-rpm.tsv').read_bytes(),proof['image']['version'])
        check(proof['instanceUid']!=proof['resizedInstanceUid'] and (folder/'reboot.png').is_file(), 'Missing reboot evidence')
        check(file_hash(folder/'reboot.png')==proof['rebootScreenshotSha256'] and ocr(folder/'reboot.png').count('proofpersisted')==1, 'Installed application persistence marker absent or screenshot changed')
        check(any(row.get('phase')=='cold resize' and row['status']==202 for row in rows), 'Successful resize response missing')
    else:
        check(proof['profile'] == profile and proof['architecture'] == ('amd64' if profile == 'windows' else 'arm64'), 'Wrong showcase profile')
        check(proof['screenMarkersVerified'] and proof['coldResizeAndFilePersistence'], 'Missing showcase assertions')
        if profile=='windows':
            expected=b'VM Interface Windows 7-Zip functional proof\n'
        else:
            challenge=(folder/'challenge.bin').read_bytes()
            check(proof['resultMode']==ANDROID_RESULT_MODE and proof['challengeBytes']==len(challenge) and file_hash(folder/'challenge.bin')==proof['challengeSha256'],'Missing exact Android challenge proof')
            check(file_hash(folder/'proof.apk')==proof['softwareSha256'] and file_hash(folder/'scenario.json')==proof['scenarioSha256'],'Android software or scenario mismatch')
            load_scenario(folder/'scenario.json','android')
            check('upload challenge' in phases,'Missing challenge upload')
            expected=android_result(challenge)
            check(proof['instanceUid']!=proof['resizedInstanceUid'] and proof['cpuAfterResize']==3 and proof['originalPvcUids']==proof['resizedPvcUids'] and len(proof['originalPvcUids'])>=2,'Missing native resize or persistent PVC identity proof')
            check('restart after resize' in phases,'Missing resize restart API call')
            transfer=proof['transferPath']
            check(transfer in ('virtiofs-saf','authorized-adb-over-private-tunnel'),'Unknown Android transfer path')
            if transfer=='authorized-adb-over-private-tunnel':
                report=json.loads((folder/'android-adb.json').read_text())
                check(file_hash(folder/'android-adb.json')==proof['guestTransferSha256'],'Guest transfer report hash mismatch')
                check(report['transferPath']==transfer and report['freshKeyAuthorized'] is True and report['adbSecure'] is True and report['selinux']=='Enforcing' and report['shellUid']==2000 and report['abi']=='arm64-v8a','Missing authenticated non-root guest security evidence')
                check(report['installedApkSha256']==proof['softwareSha256'] and report['guestChallengeSha256']==proof['challengeSha256'] and report['guestOutputSha256']==report['rebootOutputSha256']==proof['outputSha256'],'Guest transfer byte mismatch')
                check(file_hash(folder/'staged-exchange.tar')==report['stagedBundleSha256'],'Staged API bundle mismatch')
                verify_staged_bundle((folder/'staged-exchange.tar').read_bytes(),{'proof.apk':(folder/'proof.apk').read_bytes(),'challenge.bin':challenge})
                check({'staged bundle','guest transfer grant','guest transfer revoke','guest transfer ownership denial'}<=phases,'Missing private tunnel API calls')
            else:check('download file' in phases,'Missing VirtioFS download')
        check((folder/'guest-result.bin').read_bytes() == expected, 'Unexpected native result bytes')
        check(file_hash(folder/'guest-result.bin') == proof['outputSha256'], 'Output hash mismatch')
        check(file_hash(trace) == proof['traceSha256'], 'Trace checksum mismatch')
        required={'upload file','guest action'}
        if profile=='windows' or proof.get('transferPath')=='virtiofs-saf':required.add('download file')
        check(required <= phases, 'Missing native application API calls')
    return {'profile': profile, 'commit':commit, 'runId':run, 'video': video, 'httpCalls': len(rows), 'scope': 'artifact-integrity-independent-marker-decode-and-reported-assertions'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--profile', choices=['core','linux','windows','android','all'], required=True)
    p.add_argument('--commit', help='Require the exact approved Git commit in every proof')
    a = p.parse_args()
    folders = {'control': 'api-control-proof', 'functional': 'api-functional-proof',
               'windows': 'showcase-windows', 'android': 'showcase-android'}
    targets = ['control','functional'] if a.profile == 'core' else ['functional'] if a.profile == 'linux' else ['control','functional','android'] if a.profile == 'all' else [a.profile]
    report = {'passed': [], 'failed': [], 'hardwareCertifiedByVerifier': False}
    for target in targets:
        try:
            report['passed'].append(verify_folder(a.root/folders[target], target,a.commit))
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
            report['failed'].append({'profile': target, 'error': str(exc)})
    if len(report['passed'])>1:
        if len({x['commit'] for x in report['passed']})!=1:
            report['failed'].append({'profile':a.profile,'error':'Mixed source commits are not a comprehensive pass'})
        if a.profile=='core' and len({x['runId'] for x in report['passed']})!=1:
            report['failed'].append({'profile':a.profile,'error':'Core evidence must come from the same execution'})
    print(json.dumps(report, indent=2))
    raise SystemExit(bool(report['failed']))
