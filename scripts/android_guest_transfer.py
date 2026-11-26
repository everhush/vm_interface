"""Explicit authorized ADB client over VM Interface private WSS.

Only disposable test guests, ordinary non-root Android shell, SELinux Enforcing,
fresh key approved in the real guest UI. The original APK and challenge are
read back from the API's halted exchange bundle before ADB transfer. Output
returns over the authorized API tunnel, not as a fake VirtioFS publication.
"""
import hashlib
import io
import json
import os
import select
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUEST_DIR = "/sdcard/Documents/VMInterface"
PACKAGE = "org.vminterface.proof"
MAX_BUNDLE = 32 * 1024**2

def digest(data):
    return hashlib.sha256(data).hexdigest()

def verify_staged_bundle(raw, expected):
    if len(raw) > MAX_BUNDLE or set(expected) != {"proof.apk", "challenge.bin"}:
        raise ValueError("Invalid staged exchange bundle")
    names = {"upload/" + name for name in expected} | {"manifest.json"}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        members = archive.getmembers()
        if len(members) != len(names) or {m.name for m in members} != names or any(not m.isfile() for m in members):
            raise ValueError("Unexpected bundle members")
        if archive.getmember("manifest.json").size > 65536:
            raise ValueError("Oversized manifest")
        manifest = json.load(archive.extractfile("manifest.json"))
        if manifest.get("version") != 1 or manifest.get("scope") != "published-exchange-files-only":
            raise ValueError("Unexpected bundle manifest")
        files = manifest.get("files")
        wanted = [{"name": "upload/" + n, "bytes": len(b), "sha256": digest(b), "direction": "upload"}
                  for n, b in expected.items()]
        if not isinstance(files, list) or sorted(files, key=lambda x:x["name"]) != sorted(wanted,key=lambda x:x["name"]):
            raise ValueError("Bundle manifest mismatch")
        result = {}
        for name, data in expected.items():
            member = archive.getmember("upload/" + name)
            if member.size != len(data):
                raise ValueError("Staged byte count mismatch")
            actual = archive.extractfile(member).read()
            if actual != data:
                raise ValueError("Staged input differs from original")
            result[name] = actual
    return result

def device_state(output, serial):
    rows = [line.split() for line in output.decode("utf-8", errors="strict").splitlines()[1:] if line.strip()]
    if any(len(row) < 2 or row[0] != serial for row in rows) or len(rows) > 1:
        raise ValueError("Isolated ADB server has an unexpected device")
    return rows[0][1] if rows else None

def require_guest_security(secure, enforcing, uid, abi):
    if (secure, enforcing, uid, abi) != ("1", "Enforcing", "2000", "arm64-v8a"):
        raise ValueError("Require authenticated non-root ARM64 ADB with SELinux Enforcing")

def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

class AndroidGuestTransfer:
    def __init__(self, call, wait, path, token_b, output):
        self.call, self.wait, self.path, self.token_b, self.output = call, wait, path, token_b, output
        self.tmp = tempfile.TemporaryDirectory(prefix="vm-android-adb-")
        self.env = dict(os.environ)
        for name in ("ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_PORT", "ADB_SERVER_PORT", "ANDROID_SERIAL", "ANDROID_SDK_HOME", "ADB_VENDOR_KEYS","TOKEN_A","TOKEN_B","GUEST_RELAY_TOKEN"):
            self.env.pop(name, None)
        self.env.update({"HOME":self.tmp.name, "ANDROID_USER_HOME":self.tmp.name})
        self.adb = shutil.which("adb")
        if not self.adb:
            self.tmp.cleanup()
            raise ValueError("Authorized Android platform-tools adb required")
        key = Path(self.tmp.name)/"adbkey"
        subprocess.run([self.adb,"keygen",str(key)],env=self.env,check=True,capture_output=True,timeout=15)
        self.env["ADB_VENDOR_KEYS"]=str(key)
        self.port=free_port()
        self.server=subprocess.Popen([self.adb,"-L",f"tcp:127.0.0.1:{self.port}","nodaemon","server"],env=self.env,
                                     stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        self.relay = self.grant = self.serial = None
        self.expires = 0
        self.report = {"transferPath":"authorized-adb-over-private-tunnel", "freshKeyAuthorized":False}
        def listening():
            if self.server.poll() is not None:
                raise ValueError("Isolated ADB server exited")
            try:
                with socket.create_connection(("127.0.0.1",self.port),timeout=1):
                    return True
            except OSError:
                return False
        try:
            self.wait(listening,15,"ADB server did not start")
        except BaseException:
            self.close()
            raise

    def command(self, *args, target=False, timeout=30, check=True):
        command=[self.adb,"-H","127.0.0.1","-P",str(self.port)]
        if target:
            command += ["-s", self.serial]
        return subprocess.run(command+list(args),env=self.env,timeout=timeout,check=check,capture_output=True).stdout

    def state(self):
        return device_state(self.command("devices"),self.serial)

    def disconnect(self):
        if self.serial:
            try:self.command("disconnect",self.serial,check=False,timeout=10)
            except (OSError,subprocess.SubprocessError):pass
        self.serial=None
        if self.relay:
            self.relay.terminate()
            try:self.relay.wait(timeout=10)
            except subprocess.TimeoutExpired:self.relay.kill();self.relay.wait()
            self.relay=None
        if self.grant:
            self.call("DELETE",self.path+"/exposures/"+self.grant["id"],phase="guest transfer revoke")
            self.grant=None
        self.expires=0

    def open(self):
        self.disconnect()
        spec={"port":5555,"ttlSeconds":600,"access":"private-tunnel"}
        self.call("POST",self.path+"/exposures",self.token_b,body=spec,expected=404,phase="guest transfer ownership denial")
        self.grant=self.call("POST",self.path+"/exposures",body=spec,expected=201,phase="guest transfer grant")
        grant=self.grant
        assert grant["port"]==5555 and grant["access"]=="private-tunnel" and grant["active"] is True
        assert grant["path"]=="/api/v1"+self.path+"/exposures/"+grant["id"]+"/connect"
        gateway=os.environ.get("VNC_URL","wss://127.0.0.1:3443/api/v1")
        if not gateway.endswith("/api/v1"):
            raise ValueError("Expected API gateway base")
        env={**self.env,"GUEST_RELAY_URL":gateway[:-7]+grant["path"],"GUEST_RELAY_TOKEN":grant["token"]}
        self.relay=subprocess.Popen(["node","--import","tsx",str(ROOT/"scripts/guest-tcp-relay.ts")],cwd=ROOT,env=env,
                                    stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
        if not select.select([self.relay.stdout],[],[],15)[0]:
            raise TimeoutError("Private loopback relay did not start")
        port=json.loads(self.relay.stdout.readline())["port"]
        assert type(port) is int and 1<=port<=65535
        self.serial=f"127.0.0.1:{port}"
        self.expires=time.monotonic()+540

    def connect(self):
        if not self.serial or time.monotonic()>=self.expires or self.relay.poll() is not None:
            self.open()
        self.command("connect",self.serial,timeout=20,check=False)
        return self.state()

    def authorize(self, checkpoint):
        self.open()
        def unauthorized():
            state=self.connect()
            if state=="device":
                raise ValueError("Fresh key was accepted without user authorization; refusing debug")
            return state=="unauthorized"
        self.wait(unauthorized,60,"Guest did not expose authenticated ADB on the private tunnel")
        checkpoint()
        self.ensure()
        self.report["freshKeyAuthorized"]=True

    def ensure(self):
        self.wait(lambda:self.connect()=="device",45,"Authorized guest ADB unavailable")
        values=[self.command("shell",*args,target=True).decode().strip() for args in
                [("getprop","ro.adb.secure"),("getenforce",),("id","-u"),("getprop","ro.product.cpu.abi")]]
        require_guest_security(*values)
        sdk=self.command("shell","getprop","ro.build.version.sdk",target=True).decode().strip()
        if not sdk.isdigit() or int(sdk)<23:
            raise ValueError("Unexpected Android SDK")
        self.report.update({"adbSecure":True,"selinux":"Enforcing","shellUid":2000,"abi":"arm64-v8a","sdk":int(sdk)})

    def install(self, apk, challenge):
        self.ensure()
        self.command("shell","mkdir","-p","/sdcard/Documents",target=True)
        self.command("shell","mkdir",GUEST_DIR,target=True)
        self.command("push",str(challenge),GUEST_DIR+"/in-challenge.bin",target=True,timeout=60)
        actual=self.command("shell","sha256sum",GUEST_DIR+"/in-challenge.bin",target=True).decode().split()[0]
        if actual!=digest(challenge.read_bytes()):
            raise ValueError("Guest challenge copy differs from API bytes")
        result=self.command("install",str(apk),target=True,timeout=90).decode().strip()
        if result.splitlines()[-1]!="Success":
            raise ValueError("Android package installation failed")
        if not self.command("shell","pm","path",PACKAGE,target=True).startswith(b"package:"):
            raise ValueError("Expected package not installed")
        self.command("shell","am","start","-n",PACKAGE+"/.ProofActivity",target=True)
        self.report.update({"installedApkSha256":digest(apk.read_bytes()),"guestChallengeSha256":actual,
                            "package":PACKAGE})

    def absent(self):
        self.ensure()
        # The directory is freshly created and contains only the challenge.
        items=self.command("shell","ls","-1",GUEST_DIR,target=True).decode().splitlines()
        if items!=["in-challenge.bin"]:
            raise ValueError("Unexpected guest exchange contents before action")

    def result(self):
        self.ensure()
        data=self.command("exec-out","head","-c","1025",GUEST_DIR+"/out-result.txt",target=True)
        marker=self.command("exec-out","head","-c","129",GUEST_DIR+"/out-result.txt.sha256",target=True)
        if not 0<len(data)<=1024 or marker!=(digest(data)+"\n").encode("ascii"):
            raise ValueError("Guest output absent, oversized or checksum mismatch")
        self.report["guestOutputSha256"]=digest(data)
        return data

    def close(self):
        try:self.disconnect()
        finally:
            if self.server.poll() is None:
                self.server.terminate()
                try:self.server.wait(timeout=10)
                except subprocess.TimeoutExpired:self.server.kill();self.server.wait()
            self.tmp.cleanup()
