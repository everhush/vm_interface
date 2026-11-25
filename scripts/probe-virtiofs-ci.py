"""Disposable infrastructure compatibility probe, NOT a product/API file test.

Uses a dedicated namespace and a throwaway Fedora KVM guest. A non-root
companion pod writes a random challenge to a PVC; the guest must mount that
PVC via virtiofs, read and hash the challenge, then write a response. No
guest networking, host paths, Kubernetes credentials, or product resources.
"""
import hashlib
import json
import os
import re
import secrets
import subprocess
import time
from pathlib import Path

NAMESPACE = "vm-virtiofs-probe"
EVIDENCE = Path("evidence")
FEDORA = "quay.io/kubevirt/fedora-with-test-tooling-container-disk:v1.9.0"
BUSYBOX = "docker.io/library/busybox:1.37.0"

def execute(args, *, input_text=None, timeout=30, check=True):
    return subprocess.run(args, input=input_text, text=True, capture_output=True,
                          timeout=timeout, check=check)

def kubectl(*args, **kwargs):
    return execute(["kubectl", "-n", NAMESPACE, *args], **kwargs)

def apply(obj):
    kubectl("apply", "-f", "-", input_text=json.dumps(obj))

def resolve_image(image):
    digest = execute(["skopeo", "inspect", "--override-os", "linux",
                      "--override-arch", "amd64", "--format", "{{.Digest}}",
                      "docker://" + image], timeout=180).stdout.strip()
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise RuntimeError("Registry did not provide a valid digest for " + image)
    return image.rsplit(":", 1)[0] + "@" + digest

def verify_response(raw, challenge):
    result = dict(line.split("=", 1) for line in raw.strip().splitlines())
    expected = hashlib.sha256(challenge.encode("ascii")).hexdigest()
    if result.get("sha256") != expected or result.get("filesystem") != "virtiofs":
        raise AssertionError("Guest did not return the expected VirtioFS challenge")
    if not result.get("kernel") or result.get("virtio_mem_driver") not in ("present", "unavailable"):
        raise AssertionError("Guest kernel evaluation missing")
    return result

def objects(fedora, busybox):
    pvc = {
        "apiVersion": "v1", "kind": "PersistentVolumeClaim",
        "metadata": {"name": "exchange"},
        "spec": {"storageClassName": "local-path", "accessModes": ["ReadWriteOnce"],
                 "volumeMode": "Filesystem", "resources": {"requests": {"storage": "1Gi"}}},
    }
    pod = {
        "apiVersion": "v1", "kind": "Pod", "metadata": {"name": "reader"},
        "spec": {"automountServiceAccountToken": False,
                 "securityContext": {"runAsNonRoot": True, "runAsUser": 107,
                                     "runAsGroup": 107, "fsGroup": 107,
                                     "seccompProfile": {"type": "RuntimeDefault"}},
                 "containers": [{"name": "reader", "image": busybox,
                                 "command": ["sleep", "1200"],
                                 "securityContext": {"allowPrivilegeEscalation": False,
                                                     "capabilities": {"drop": ["ALL"]}},
                                 "resources": {"requests": {"cpu": "10m", "memory": "16Mi"},
                                               "limits": {"cpu": "100m", "memory": "64Mi"}},
                                 "volumeMounts": [{"name": "exchange", "mountPath": "/probe"}]}],
                 "volumes": [{"name": "exchange", "persistentVolumeClaim": {"claimName": "exchange"}}]},
    }
    userdata = """#!/bin/bash
set -eu
mkdir -p /mnt/probe
modprobe virtiofs || true
mount -t virtiofs exchange /mnt/probe
test "$(findmnt -n -o FSTYPE /mnt/probe)" = virtiofs
hash=$(sha256sum /mnt/probe/challenge | cut -d ' ' -f 1)
driver=unavailable
if modprobe virtio_mem 2>/dev/null; then driver=present; fi
umask 077
printf 'sha256=%s\\nfilesystem=virtiofs\\nkernel=%s\\nvirtio_mem_driver=%s\\n' "$hash" "$(uname -r)" "$driver" > /mnt/probe/response.tmp
mv /mnt/probe/response.tmp /mnt/probe/response
sync
"""
    vmi = {
        "apiVersion": "kubevirt.io/v1", "kind": "VirtualMachineInstance",
        "metadata": {"name": "virtiofs-probe"},
        "spec": {"architecture": "amd64", "nodeSelector": {"kubernetes.io/arch": "amd64"},
                 "domain": {"cpu": {"cores": 1}, "resources": {"requests": {"memory": "1536Mi"}},
                            "devices": {"autoattachPodInterface": False, "rng": {},
                                        "disks": [{"name": "boot", "disk": {"bus": "virtio"}},
                                                  {"name": "cloudinit", "disk": {"bus": "virtio"}}],
                                        "filesystems": [{"name": "exchange", "virtiofs": {}}]}},
                 "networks": [],
                 "volumes": [{"name": "boot", "containerDisk": {"image": fedora}},
                             {"name": "cloudinit", "cloudInitNoCloud": {"userData": userdata}},
                             {"name": "exchange", "persistentVolumeClaim": {"claimName": "exchange"}}]},
    }
    return pvc, pod, vmi

def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Run only in disposable hosted GitHub Actions")
    EVIDENCE.mkdir(exist_ok=True)
    result = {"scope": "infrastructure-only", "virtiofs": "not-verified",
              "virtioMemLiveResize": "not-tested"}
    created = False
    try:
        fedora, busybox = resolve_image(FEDORA), resolve_image(BUSYBOX)
        result["images"] = {"fedora": fedora, "reader": busybox,
                            "source": FEDORA, "architecture": "amd64"}
        execute(["kubectl", "create", "namespace", NAMESPACE])
        created = True
        pvc, pod, vmi = objects(fedora, busybox)
        apply(pvc)
        apply(pod)
        kubectl("wait", "pod/reader", "--for=condition=Ready", "--timeout=180s", timeout=200)
        challenge = secrets.token_hex(32)
        kubectl("exec", "reader", "--", "sh", "-c",
                'umask 077; printf "%s" "$1" > /probe/challenge', "sh", challenge)
        apply(vmi)
        kubectl("wait", "vmi/virtiofs-probe", "--for=condition=Ready", "--timeout=420s", timeout=440)
        deadline = time.monotonic() + 360
        while time.monotonic() < deadline:
            r = kubectl("exec", "reader", "--", "cat", "/probe/response", check=False)
            if r.returncode == 0:
                result.update(verify_response(r.stdout, challenge))
                result["virtiofs"] = "guest-mount-and-byte-roundtrip-verified"
                break
            time.sleep(5)
        else:
            raise TimeoutError("No guest-written response through VirtioFS")
        print("Infrastructure VirtioFS guest mount/read/write verified; product file API not certified.")
    except Exception as exc:
        result["failureType"] = type(exc).__name__
        if isinstance(exc, subprocess.CalledProcessError):
            result["stderr"] = exc.stderr[-2000:]
        else:
            result["failure"] = str(exc)
        raise
    finally:
        (EVIDENCE / "virtiofs-infrastructure.json").write_text(json.dumps(result, indent=2))
        if created:
            for name, args in [("virtiofs-resources.txt", ("get", "vmi,pod,pvc", "-o", "wide")),
                               ("virtiofs-events.txt", ("get", "events", "--sort-by=.lastTimestamp"))]:
                diagnostic = kubectl(*args, check=False)
                (EVIDENCE / name).write_text(diagnostic.stdout + diagnostic.stderr)
            execute(["kubectl", "delete", "namespace", NAMESPACE, "--wait=false"], check=False)

if __name__ == "__main__":
    main()
