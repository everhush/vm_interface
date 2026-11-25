"""Fetch manifest-pinned public media; never install/execute downloaded content."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

SOURCES = Path(__file__).resolve().parents[1] / "showcases" / "media-sources.json"

def fetch(key, directory):
    spec = json.loads(SOURCES.read_text())[key]
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / spec["name"]
    if target.exists() or target.is_symlink():
        raise ValueError("Refusing to overwrite media")
    limit = spec.get("bytes", 256 * 1024**2)
    try:
        subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                        "--proto", "=https", "--proto-redir", "=https",
                        "--connect-timeout", "30", "--max-time", "600",
                        "--max-filesize", str(limit), "--output", str(target),
                        spec["url"]], check=True, timeout=630)
        if target.stat().st_size > limit or (spec.get("bytes") and target.stat().st_size != limit):
            raise ValueError("Source length differs from pinned bound")
        with target.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != spec["sha256"]:
            raise ValueError("Source digest differs from pinned manifest")
        return target
    except BaseException:
        target.unlink(missing_ok=True)
        raise

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", choices=["android", "winfsp", "virtio", "software"])
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    print(fetch(args.source, args.directory))
