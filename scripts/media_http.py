"""Bounded binary HTTP client for explicit media mutations.

curl handles early final HTTP responses while an upload is still in flight.
Credentials are passed via a private subprocess stdin config, never argv/logs.
No redirects, no automatic retry, no synthetic HTTP status.
"""
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

MAX_BYTES=64*1024*1024


def quote(value):
    if any(ord(ch)<32 or ord(ch)==127 for ch in value):
        raise ValueError("Invalid HTTP configuration value")
    return '"' + value.replace("\\","\\\\").replace('"','\\"') + '"'


def binary_request(url,method,headers,body):
    u=urlsplit(url)
    if u.scheme not in ("http","https") or not u.hostname or u.username or u.password or u.fragment:
        raise ValueError("Expected explicit HTTP(S) endpoint")
    if method!="PUT" or not 1<=len(body)<=MAX_BYTES:
        raise ValueError("Expected bounded media PUT")
    with tempfile.TemporaryDirectory(prefix="vm-media-client-") as folder:
        path=Path(folder)/"body"
        path.write_bytes(body)
        config=[
            "silent","show-error","http1.1","noproxy = "+quote("*"),
            "proto = "+quote("=http,https"),
            "url = "+quote(url),"request = "+quote(method),
            "connect-timeout = 10","max-time = 240","expect100-timeout = 1",
            "max-filesize = 1048576",
            "data-binary = "+quote("@"+str(path)),
            "header = "+quote("Expect: 100-continue"),
            *["header = "+quote(k+": "+v) for k,v in headers.items()],
            'write-out = "\\n%{http_code}"',
        ]
        result=subprocess.run(["curl","--disable","--config","-"],
                              input=("\n".join(config)+"\n").encode(),
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              timeout=250,check=False)
        if result.returncode:
            raise ConnectionError("Media HTTP transport failed (curl exit "+str(result.returncode)+"); inspect operation state, do not blindly retry")
        payload,separator,status=result.stdout.rpartition(b"\n")
        if not separator or len(status)!=3 or not status.isdigit() or not 100<=int(status)<=599:
            raise ConnectionError("Missing actual HTTP response")
        return int(status),payload
