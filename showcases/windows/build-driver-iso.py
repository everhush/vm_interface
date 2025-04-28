#!/usr/bin/env python3
"""Package authorized Windows driver MSIs without executing them on the host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

MAX_MSI = 256 * 1024**2
MSI_MAGIC = bytes.fromhex('d0cf11e0a1b11ae1')


def stage_package(source, dest, sha256, thumbprint):
    if not re.fullmatch(r'[a-f0-9]{64}', sha256):
        raise ValueError('Expected lowercase SHA256')
    if not re.fullmatch(r'[A-Fa-f0-9]{40}', thumbprint):
        raise ValueError('Expected signer certificate thumbprint')
    if source.is_symlink() or not source.is_file():
        raise ValueError('Expected regular authorized MSI')
    total = 0
    digest = hashlib.sha256()
    with source.open('rb') as inp, dest.open('xb') as out:
        head = inp.read(8)
        if head != MSI_MAGIC:
            raise ValueError('Expected MSI compound-file header')
        inp.seek(0)
        while data := inp.read(1024**2):
            total += len(data)
            if total > MAX_MSI:
                raise ValueError('MSI exceeds bounded size')
            digest.update(data)
            out.write(data)
    if digest.hexdigest() != sha256:
        raise ValueError('MSI SHA256 mismatch')
    return {'name': dest.name, 'bytes': total, 'sha256': sha256,
            'signerThumbprint': thumbprint.upper()}


def build(args):
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('Refusing output overwrite')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as tmp:
        tmp = Path(tmp)
        root = tmp/'media'
        root.mkdir()
        packages = [stage_package(args.winfsp, root/'winfsp.msi', args.winfsp_sha256, args.winfsp_signer),
                    stage_package(args.virtio, root/'virtio.msi', args.virtio_sha256, args.virtio_signer)]
        shutil.copyfile(Path(__file__).with_name('bootstrap.ps1'), root/'bootstrap.ps1')
        (root/'packages.json').write_text(json.dumps(packages, indent=2)+'\n')
        iso = tmp/'drivers.iso'
        subprocess.run(['xorriso','-as','mkisofs','-quiet','-R','-J','-V','VMDRIVERS','-o',str(iso),str(root)], check=True, timeout=180)
        with iso.open('rb') as f:
            sha = hashlib.file_digest(f, 'sha256').hexdigest()
        size = iso.stat().st_size
        os.link(iso, args.output)
        return {'bytes': size, 'sha256': sha, 'packages': packages,
                'sizeGiB': max(1, (size+64*1024**2+966367640-1)//966367640),
                'guestSignatureAndMountVerified': False}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    for package in ('winfsp','virtio'):
        p.add_argument('--'+package, type=Path, required=True)
        p.add_argument('--'+package+'-sha256', required=True)
        p.add_argument('--'+package+'-signer', required=True)
    p.add_argument('--authorized', action='store_true', required=True)
    print(json.dumps(build(p.parse_args()), indent=2))
