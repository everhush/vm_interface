"""Explicitly authorized, bounded client-side acquisition of public images.

No backend URL fetch, ambient proxy, credentials, or automatic redirect. DNS
answers are checked and the TCP connection is pinned to a checked public IP;
TLS still authenticates the requested DNS hostname.
"""
import hashlib
import http.client
import ipaddress
import os
import re
import socket
import ssl
import stat
import tempfile
import time
from pathlib import Path
from urllib.parse import urljoin, urlsplit

MAX_BYTES = 8 * 1024**3
BLOCK = 1024 * 1024
HOST = re.compile(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")


def allowed_url(url, allowed_hosts):
    u = urlsplit(url)
    host = u.hostname
    if (u.scheme != "https" or not host or host not in allowed_hosts
            or not HOST.fullmatch(host) or "." not in host
            or u.netloc not in (host, host + ":443")
            or u.username is not None or u.password is not None
            or u.port not in (None, 443) or u.fragment
            or any(ord(c) < 33 or ord(c) == 127 for c in url)
            or "\\" in url):
        raise ValueError("Unapproved HTTPS URL")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return u
    raise ValueError("DNS hostname required")


def public_address(value):
    ip = ipaddress.ip_address(value)
    if (not ip.is_global or ip.is_multicast or ip.is_reserved
            or ip.is_loopback or ip.is_link_local
            or (ip.version == 6 and
                (ip.ipv4_mapped is not None or ip.sixtofour is not None
                 or ip.teredo is not None or ip in ipaddress.ip_network("64:ff9b::/96")
                 or ip in ipaddress.ip_network("64:ff9b:1::/48")))):
        raise ValueError("Non-public DNS answer")
    return str(ip)


def resolve_public(host):
    answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    ips = list(dict.fromkeys(public_address(info[4][0]) for info in answers))
    if not ips:
        raise ValueError("No public DNS answers")
    return sorted(ips, key=lambda x: ipaddress.ip_address(x).version)


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address, timeout):
        super().__init__(host, port=443, timeout=timeout,
                         context=ssl.create_default_context())
        self.address = public_address(address)

    def connect(self):
        ip = ipaddress.ip_address(self.address)
        raw = socket.socket(socket.AF_INET if ip.version == 4 else socket.AF_INET6,
                            socket.SOCK_STREAM)
        try:
            raw.settimeout(self.timeout)
            raw.connect((self.address, 443))
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def checked_stream(stream, out, expected_sha, max_bytes, expected_bytes=None,
                   deadline=None):
    digest = hashlib.sha256()
    count = 0
    reader = getattr(stream, "read1", stream.read)
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            raise TimeoutError("Download exceeded deadline")
        data = reader(BLOCK)
        if not data:
            break
        count += len(data)
        if count > max_bytes:
            raise ValueError("Image exceeds bound")
        digest.update(data)
        out.write(data)
    if (count < 512 or digest.hexdigest() != expected_sha
            or (expected_bytes is not None and count != expected_bytes)):
        raise ValueError("Image size or digest mismatch")
    return count


def download(url, allowed_hosts, out, expected_sha, max_bytes, expected_bytes,
             timeout):
    deadline = time.monotonic() + timeout
    for _ in range(6):
        u = allowed_url(url, allowed_hosts)
        addresses = resolve_public(u.hostname)
        connection = None
        try:
            for address in addresses:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Download exceeded deadline")
                connection = PinnedHTTPS(u.hostname, address, min(30, remaining))
                try:
                    connection.connect()
                    break
                except OSError:
                    connection.close()
                    connection = None
            if connection is None:
                raise ConnectionError("No approved address could connect")
            path = u.path or "/"
            if u.query:
                path += "?" + u.query
            connection.request("GET", path, headers={
                "Accept-Encoding": "identity", "Connection": "close",
                "User-Agent": "vm-interface-authorized-image-client/1"
            })
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                locations = response.headers.get_all("Location", [])
                if len(locations) != 1:
                    raise ValueError("Ambiguous redirect")
                url = urljoin(url, locations[0])
                allowed_url(url, allowed_hosts)
                continue
            if response.status != 200:
                raise ValueError("Image source HTTP status " + str(response.status))
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise ValueError("Encoded response refused")
            lengths = response.headers.get_all("Content-Length", [])
            length = None
            if lengths:
                if len(lengths) != 1 or not lengths[0].isdigit():
                    raise ValueError("Ambiguous content length")
                length = int(lengths[0])
                if length < 512 or length > max_bytes:
                    raise ValueError("Advertised image size exceeds bound")
                if expected_bytes is not None and length != expected_bytes:
                    raise ValueError("Advertised size differs from pin")
            return checked_stream(response, out, expected_sha, max_bytes,
                                  expected_bytes if expected_bytes is not None else length,
                                  deadline)
        finally:
            if connection is not None:
                connection.close()
    raise ValueError("Too many redirects")


def private_cache(root):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Cache must be an owned, private directory")
    return root


def copy_cache(source, output, digest, limit, size):
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as cached:
        info = os.fstat(cached.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("Invalid cache entry")
        return checked_stream(cached, output, digest, limit, size)


def acquire(url, output, sha256, allowed_hosts, max_bytes=MAX_BYTES,
            expected_bytes=None, cache=None, timeout=600):
    output = Path(output)
    if not SHA.fullmatch(sha256) or not 512 <= max_bytes <= MAX_BYTES:
        raise ValueError("Invalid digest or size bound")
    if expected_bytes is not None and not 512 <= expected_bytes <= max_bytes:
        raise ValueError("Invalid expected size")
    if not 1 <= timeout <= 3600:
        raise ValueError("Invalid timeout")
    source = allowed_url(url, allowed_hosts)
    if output.exists() or output.is_symlink():
        raise FileExistsError("Refusing to overwrite output")
    entry = private_cache(Path(cache)) / sha256 if cache is not None else None
    fd, temp_name = tempfile.mkstemp(prefix=".image-part-", dir=output.parent)
    temp = Path(temp_name)
    cached = entry is not None and (entry.exists() or entry.is_symlink())
    try:
        with os.fdopen(fd, "wb") as out:
            if cached:
                count = copy_cache(entry, out, sha256, max_bytes, expected_bytes)
            else:
                count = download(url, allowed_hosts, out, sha256, max_bytes,
                                 expected_bytes, timeout)
            out.flush()
            os.fsync(out.fileno())
        if entry is not None and not cached:
            # Separate cache inode; modifying the output cannot modify cached bytes.
            cache_fd, cache_name = tempfile.mkstemp(prefix=".cache-part-", dir=entry.parent)
            cache_temp = Path(cache_name)
            try:
                with os.fdopen(cache_fd, "wb") as dest, temp.open("rb") as src:
                    checked_stream(src, dest, sha256, max_bytes, expected_bytes)
                    dest.flush()
                    os.fsync(dest.fileno())
                    os.fchmod(dest.fileno(), 0o400)
                try:
                    os.link(cache_temp, entry)
                except FileExistsError:
                    # A concurrent valid download won the publish race. Do not replace it.
                    pass
            finally:
                cache_temp.unlink(missing_ok=True)
        os.link(temp, output)
        return {"bytes": count, "sha256": sha256, "sourceHost": source.hostname,
                "authorizedByClient": True, "cacheHit": cached}
    finally:
        temp.unlink(missing_ok=True)
