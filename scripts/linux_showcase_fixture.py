"""Reproducible, client-owned Linux application package (not a platform agent)."""
import hashlib
import io
import zipfile

APP = "import hashlib, json, os, platform, stat, subprocess, sys, time, zipfile\nfrom pathlib import Path\nroot=Path(\"/mnt/exchange\")\ndata=(root/\"in-challenge.bin\").read_bytes()\nassert len(data)==4096\nresult=b\"guest-result:\"+hashlib.sha256(data).hexdigest().encode(\"ascii\")+b\"\\n\"\ndef publish(name, data):\n    tmp=root/(\".\"+name+\".tmp\")\n    tmp.write_bytes(data)\n    os.replace(tmp,root/(\"out-\"+name))\n    tmp=root/(\".\"+name+\".sha256.tmp\")\n    tmp.write_text(hashlib.sha256(data).hexdigest()+\"\\n\")\n    os.replace(tmp,root/(\"out-\"+name+\".sha256\"))\ndef device(name):\n    path=Path(\"/dev/disk/by-id/virtio-d-\"+name)\n    until=time.monotonic()+30\n    while not path.exists() and time.monotonic()<until:\n        time.sleep(0.5)\n    st=path.stat()\n    if not stat.S_ISBLK(st.st_mode):\n        raise RuntimeError(\"Expected named virtio block device\")\n    return path,st.st_rdev\ndef read_block(path):\n    with path.open(\"rb\",buffering=0) as stream:\n        return stream.read(len(data))\ndef write_block(path,content):\n    with path.open(\"r+b\",buffering=0) as stream:\n        assert stream.write(content)==len(content)\n        os.fsync(stream.fileno())\n    assert read_block(path)==content\nos.umask(0o002)\noriginal,source_id=device(\"proof\")\nif sys.argv[1:]==[\"--verify-clone\"]:\n    clone,target_id=device(\"proofcopy\")\n    assert source_id!=target_id and read_block(original)==data and read_block(clone)==data\n    # Distinct copy: changing it must not alter the source bytes.\n    alternate=bytes(x^255 for x in data)\n    write_block(clone,alternate)\n    assert read_block(original)==data\n    publish(\"disk-original-after.bin\",read_block(original))\n    publish(\"disk-clone-after.bin\",read_block(clone))\n    os.sync()\n    print(\"proofpersisted\",flush=True)\nelse:\n    assert not sys.argv[1:]\n    write_block(original,data)\n    publish(\"disk-original.bin\",read_block(original))\n    tmp=root/\".proof-archive.tmp\"\n    with zipfile.ZipFile(tmp,\"w\",compression=zipfile.ZIP_STORED) as archive:\n        archive.writestr(zipfile.ZipInfo(\"challenge.bin\"),data)\n    with zipfile.ZipFile(tmp,\"r\") as archive:\n        if archive.testzip() is not None or archive.read(\"challenge.bin\")!=data:\n            raise RuntimeError(\"archive verification failed\")\n    publish(\"archive.zip\",tmp.read_bytes())\n    tmp.unlink()\n    release=Path(\"/etc/os-release\").read_bytes()\n    assert platform.machine()==\"x86_64\"\n    publish(\"guest-platform.json\",json.dumps({\"machine\":platform.machine(),\"release\":release.decode()},sort_keys=True).encode())\n    # Read-only inventory of installed distribution packages; no account data.\n    rpm=subprocess.check_output([\"rpm\",\"-qa\",\"--qf\",\"%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{LICENSE}\\n\"],timeout=60)\n    assert 0<len(rpm)<=8*1024*1024\n    publish(\"guest-rpm.tsv\",b\"\\n\".join(sorted(rpm.splitlines()))+b\"\\n\")\n    publish(\"result.bin\",result)\n    os.sync()\n    print(\"proofcomplete\",flush=True)\n    print(result.decode(\"ascii\"),flush=True)\n"

def package():
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,"w",compression=zipfile.ZIP_STORED) as z:
        z.writestr(zipfile.ZipInfo("proof.py"),APP.encode("utf-8"))
    return stream.getvalue()

def verify_archive(raw, challenge):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        if z.namelist()!=["challenge.bin"] or z.testzip() is not None or z.read("challenge.bin")!=challenge:
            raise ValueError("Guest archive did not preserve the actual challenge bytes")

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def verify_platform(platform_raw, rpm_raw, version):
    import json, re
    platform=json.loads(platform_raw)
    if platform.get("machine")!="x86_64":
        raise ValueError("Unexpected guest architecture")
    release=platform.get("release","")
    pairs=dict(line.split("=",1) for line in release.splitlines() if "=" in line and not line.startswith("#"))
    if pairs.get("ID","").strip('"')!="fedora" or pairs.get("VERSION_ID","").strip('"')!=str(version):
        raise ValueError("Guest Fedora version differs from pinned catalog")
    rows=rpm_raw.decode("utf-8").splitlines()
    if not rows or rows!=sorted(rows) or any(len(row.split("\t"))!=3 or not all(row.split("\t")) for row in rows):
        raise ValueError("Invalid guest package/license inventory")
    if not any(row.startswith("fedora-release") for row in rows):
        raise ValueError("Missing Fedora distribution package")


CLOUD = r"""#!/bin/bash
set -eu
mkdir -p /mnt/exchange
cat >/usr/local/bin/proof-launch.py <<'PY'
import hashlib,subprocess,zipfile,time
from pathlib import Path
r=Path("/mnt/exchange")
p=Path("/usr/local/lib/vm-interface-proof/proof.py")
def sha(b):return hashlib.sha256(b).hexdigest()
if p.is_file():
    if sha(p.read_bytes())!="__APP_SHA__":raise SystemExit("bad installed digest")
    subprocess.run(["/usr/bin/python3","-u",str(p),"--verify-clone"],check=True)
else:
    print("proofready",flush=True)
    print("Type runproof then Enter",flush=True)
    if input().strip()!="runproof":raise SystemExit("bad command")
    z=r/"in-proof.zip"
    if sha(z.read_bytes())!="__PACKAGE_SHA__":raise SystemExit("bad package")
    with zipfile.ZipFile(z) as a:
        if a.namelist()!=["proof.py"] or a.testzip()!=None:raise SystemExit("bad ZIP")
        b=a.read("proof.py")
    if sha(b)!="__APP_SHA__":raise SystemExit("bad app")
    p.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
    with p.open("xb") as s:s.write(b)
    subprocess.run(["/usr/bin/python3","-u",str(p)],check=True)
time.sleep(180)
PY
cat >/etc/systemd/system/vm-interface-proof.service <<'UNIT'
[Unit]
Conflicts=getty@tty1.service
After=systemd-user-sessions.service
[Service]
ExecStartPre=/usr/bin/mount -t virtiofs exchange /mnt/exchange
ExecStart=/usr/bin/python3 -u /usr/local/bin/proof-launch.py
StandardInput=tty-force
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable vm-interface-proof.service
systemctl stop getty@tty1.service
systemctl start --no-block vm-interface-proof.service
chvt 1
"""

def launcher_cloud():
    value=CLOUD.replace("__PACKAGE_SHA__",digest(package())).replace("__APP_SHA__",digest(APP.encode("utf-8")))
    if len(value.encode("utf-8"))>2048:raise ValueError("KubeVirt inline cloud-init limit")
    return value
