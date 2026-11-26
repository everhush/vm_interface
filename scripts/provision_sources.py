"""Fetch fixed provisioning inputs and fail closed before any install/apply."""
import argparse
import hashlib
import json
import platform
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

COMMON = {"install.sh", "kubevirt-operator.yaml", "kubevirt-cr.yaml",
          "cdi-operator.yaml", "cdi-cr.yaml", "cnpg.yaml"}
ARCH = {"x86_64": "k3s-amd64", "aarch64": "k3s-arm64"}

def load(manifest, arch):
    if arch not in ARCH or manifest.get("version") != 1:
        raise ValueError("Unsupported manifest or architecture")
    selected, seen = [], set()
    for row in manifest["assets"]:
        name, url, size, digest, architecture = (row[k] for k in ("name","url","bytes","sha256","architecture"))
        parsed = urlsplit(url)
        if (name in seen or name not in COMMON | set(ARCH.values()) or parsed.scheme != "https"
                or parsed.netloc not in {"github.com", "raw.githubusercontent.com"}
                or parsed.query or parsed.fragment or not re.fullmatch("[0-9a-f]{64}", digest)
                or type(size) is not int or not 0 < size <= 100*1024*1024
                or architecture not in {"all", *ARCH}):
            raise ValueError("Invalid provisioning asset: " + name)
        seen.add(name)
        if architecture in ("all", arch):
            selected.append(row)
    if {row["name"] for row in selected} != COMMON | {ARCH[arch]}:
        raise ValueError("Incomplete architecture provisioning manifest")
    return selected

def verify(path, row):
    if path.stat().st_size != row["bytes"]:
        raise ValueError("Wrong asset size: " + row["name"])
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != row["sha256"]:
            raise ValueError("Wrong asset digest: " + row["name"])

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory", required=True, type=Path)
    p.add_argument("--evidence", required=True, type=Path)
    args = p.parse_args()
    rows = load(json.loads((Path(__file__).resolve().parents[1]/"infra/provision-sources.json").read_text()), platform.machine())
    for row in rows:
        target = args.directory / row["name"]
        if target.exists():
            raise ValueError("Refusing to overwrite existing provisioning input")
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--max-time", "300",
                        "--proto", "=https", "--proto-redir", "=https", "--max-filesize", str(row["bytes"]),
                        "--output", str(target), row["url"]], check=True)
        verify(target, row)
    args.evidence.write_text(json.dumps({"architecture": platform.machine(), "assets": rows,
                                        "allBytesVerified": True}, indent=2)+"\n")

if __name__ == "__main__":
    main()
