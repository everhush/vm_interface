#!/usr/bin/env python3
"""Read-only host preflight. KVM_CREATE_VM is not a guest or native proof."""
import argparse
import fcntl
import json
import os
import platform
import shutil
from pathlib import Path

ARCH = {"x86_64": "amd64", "aarch64": "arm64"}

def inspect(expected, large=False):
    arch = ARCH.get(platform.machine(), platform.machine())
    mem = 0
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemTotal:'):
            mem = int(line.split()[1]) // 1024
            break
    free = shutil.disk_usage('/').free // (1024**3)
    result = {'scope': 'host-preflight-only', 'architecture': arch, 'expectedArchitecture': expected,
              'memoryMiB': mem, 'freeGiB': free, 'kvmDevice': False, 'kvmApiVersion': None,
              'kvmCreateVm': False, 'nativeAccelerationCertified': False, 'errors': []}
    if arch != expected:
        result['errors'].append('Architecture mismatch')
    if mem < (12288 if large else 6144):
        result['errors'].append('Insufficient RAM for selected disposable profile')
    if free < (100 if large else 35):
        result['errors'].append('Insufficient free root filesystem space for selected profile')
    try:
        fd = os.open('/dev/kvm', os.O_RDWR | os.O_CLOEXEC)
        result['kvmDevice'] = True
        try:
            result['kvmApiVersion'] = fcntl.ioctl(fd, 0xAE00, 0)
            if result['kvmApiVersion'] != 12:
                raise RuntimeError('Unexpected KVM API version')
            vm = fcntl.ioctl(fd, 0xAE01, 0)
            os.close(vm)
            result['kvmCreateVm'] = True
        finally:
            os.close(fd)
    except (OSError, RuntimeError) as exc:
        result['errors'].append(type(exc).__name__ + ': ' + str(exc))
    result['passed'] = not result['errors']
    return result

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--architecture', choices=['amd64', 'arm64'], required=True)
    p.add_argument('--large-media', action='store_true')
    p.add_argument('--output', type=Path)
    args = p.parse_args()
    report = inspect(args.architecture, args.large_media)
    encoded = json.dumps(report, indent=2) + '\n'
    print(encoded, end='')
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    raise SystemExit(0 if report['passed'] else 1)
