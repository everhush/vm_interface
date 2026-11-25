"""Reproducible, client-owned Linux application package (not a platform agent)."""
import hashlib
import io
import zipfile

APP = "import hashlib, os, zipfile\nfrom pathlib import Path\nroot=Path(\"/mnt/exchange\")\ndata=(root/\"in-challenge.bin\").read_bytes()\nresult=b\"guest-result:\"+hashlib.sha256(data).hexdigest().encode(\"ascii\")+b\"\\n\"\ndef publish(name, data):\n    tmp=root/(\".\"+name+\".tmp\")\n    tmp.write_bytes(data)\n    os.replace(tmp,root/(\"out-\"+name))\n    tmp=root/(\".\"+name+\".sha256.tmp\")\n    tmp.write_text(hashlib.sha256(data).hexdigest()+\"\\n\")\n    os.replace(tmp,root/(\"out-\"+name+\".sha256\"))\nos.umask(0o002)\ntmp=root/\".proof-archive.tmp\"\nwith zipfile.ZipFile(tmp,\"w\",compression=zipfile.ZIP_STORED) as archive:\n    archive.writestr(zipfile.ZipInfo(\"challenge.bin\"),data)\nwith zipfile.ZipFile(tmp,\"r\") as archive:\n    if archive.testzip() is not None or archive.read(\"challenge.bin\")!=data:\n        raise RuntimeError(\"archive verification failed\")\npublish(\"archive.zip\",tmp.read_bytes())\ntmp.unlink()\npublish(\"result.bin\",result)\nos.sync()\nprint(\"proofcomplete\",flush=True)\nprint(result.decode(\"ascii\"),flush=True)\n"

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
