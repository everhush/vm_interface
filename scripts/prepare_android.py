"""Offline, bounded preparation of an authorized two-disk Android QEMU bundle."""
import argparse
import hashlib
import json
import math
import os
import stat
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

GIB = 1024**3
MAX_DISK_BYTES = 8*GIB
MAX_VIRTUAL_BYTES = 64*GIB
SOURCE = 'https://github.com/jqssun/android-lineage-qemu/releases/download/v2026.10.18/UTM-VM-lineage-23.2-20261019-jqssun-virtio_arm64only.zip'
ARCHIVE_SHA = '171c0d215899d68f070fd45aea05ddb25737cf4ff16a25468e7cafbc65f4d8c9'
ARCHIVE_SIZE = 1121501784


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def qcow_capacity(header):
    if len(header) < 72 or header[:4] != b'QFI\xfb':
        raise ValueError('Not a QCOW2 image')
    version = struct.unpack_from('>I', header, 4)[0]
    backing, backing_len = struct.unpack_from('>QI', header, 8)
    size, crypt = struct.unpack_from('>QI', header, 24)
    cluster_bits = struct.unpack_from('>I',header,20)[0]
    if version not in (2, 3) or backing or backing_len or crypt:
        raise ValueError('Unsupported backing chain, format or encryption')
    if not 9 <= cluster_bits <= 21:
        raise ValueError('Invalid cluster bits')
    if version == 3 and (len(header) < 104 or struct.unpack_from('>Q', header, 72)[0] & ~24 or not 104 <= struct.unpack_from('>I',header,100)[0] <= 2**cluster_bits):
        raise ValueError('Unsupported QCOW2 v3 features or header length')
    if not 512 <= size <= MAX_VIRTUAL_BYTES or size % 512:
        raise ValueError('Invalid virtual capacity')
    # CDI filesystem overhead and spare space are accounted for independently.
    capacity = math.ceil((size + 64*1024**2)/(0.9*GIB))
    if capacity > 64:
        raise ValueError('Virtual disk exceeds supported PVC capacity')
    return size, capacity


def prepare(archive, expected_sha, output, check_disk):
    if digest(archive) != expected_sha:
        raise ValueError('Archive digest mismatch')
    if output.exists():
        raise ValueError('Output already exists; refusing overwrite')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        work = Path(tmp)/'disks'
        work.mkdir(mode=0o700)
        records = {}
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) > 256:
                raise ValueError('Unexpected archive entry count')
            selected = {}
            for member in members:
                path = PurePosixPath(member.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in member.filename:
                    raise ValueError('Unsafe archive path')
                if path.name not in ('vda.qcow2', 'vdb.qcow2'):
                    continue
                if path.parent.name != 'Data' or path.name in selected or stat.S_ISLNK(member.external_attr >> 16):
                    raise ValueError('Unexpected or duplicate disk entry')
                if not 104 <= member.file_size <= MAX_DISK_BYTES:
                    raise ValueError('Disk archive member exceeds bound')
                selected[path.name] = member
            if set(selected) != {'vda.qcow2','vdb.qcow2'} or len({str(PurePosixPath(m.filename).parent) for m in selected.values()}) != 1:
                raise ValueError('Exactly two disks in one VM bundle required')
            for filename, member in selected.items():
                dest = work/filename
                with bundle.open(member) as source, dest.open('xb') as out:
                    head = source.read(104)
                    size, capacity = qcow_capacity(head)
                    out.write(head)
                    count = len(head)
                    while block := source.read(1024**2):
                        count += len(block)
                        if count > member.file_size or count > MAX_DISK_BYTES:
                            raise ValueError('Extracted disk exceeds declared size')
                        out.write(block)
                    if count != member.file_size:
                        raise ValueError('Extracted disk size mismatch')
                    out.flush()
                    os.fsync(out.fileno())
                check_disk(dest, size)
                records[filename] = {'bytes': count, 'sha256': digest(dest), 'virtualBytes': size, 'sizeGiB': capacity}
        (work/'disks.json').write_text(json.dumps(records, indent=2)+'\n')
        # Atomic rename into a new output directory. Never unpack other entries.
        work.rename(output)
    return records


def check_qemu(path, size):
    info = json.loads(subprocess.check_output(['qemu-img','info','-f','qcow2','--output=json',str(path)], timeout=60))
    if info.get('format') != 'qcow2' or info.get('virtual-size') != size or info.get('backing-filename') or info.get('encrypted'):
        raise ValueError('Unexpected qemu-img metadata')
    subprocess.run(['qemu-img','check','-f','qcow2',str(path)], check=True, timeout=300, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--authorized', action='store_true', required=True)
    a = p.parse_args()
    if a.archive.stat().st_size != ARCHIVE_SIZE:
        raise SystemExit('Wrong pinned archive size')
    result = prepare(a.archive, ARCHIVE_SHA, a.output, check_qemu)
    print(json.dumps({'source':SOURCE,'archiveSha256':ARCHIVE_SHA,'architecture':'arm64','disks':result,'bootCertified':False}, indent=2))
