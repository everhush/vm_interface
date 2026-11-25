"""Client-side bounded HTTPS acquisition; no server-side arbitrary URL fetch."""
import argparse, hashlib, json, os, re, tempfile, urllib.request, urllib.parse
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument("url");p.add_argument("output",type=Path);p.add_argument("--sha256",required=True)
p.add_argument("--allow-host",action="append",required=True)
p.add_argument("--max-bytes",type=int,default=8*1024**3)
p.add_argument("--authorized",action="store_true",required=True)
a=p.parse_args()
assert re.fullmatch("[a-f0-9]{64}",a.sha256)
assert 512<=a.max_bytes<=8*1024**3
def allowed(url):
    u=urllib.parse.urlsplit(url)
    return u.scheme=="https" and u.hostname in a.allow_host and not u.username and not u.password and u.port in (None,443)
class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if not allowed(newurl):raise ValueError("Unapproved redirect")
        return super().redirect_request(req,fp,code,msg,headers,newurl)
assert allowed(a.url)
assert not a.output.exists()
fd, tmp=tempfile.mkstemp(prefix=".image-part-",dir=a.output.parent)
temp=Path(tmp)
digest=hashlib.sha256();count=0
try:
    with os.fdopen(fd,"wb") as out:
        with urllib.request.build_opener(Redirect).open(a.url,timeout=60) as res:
            if not allowed(res.geturl()):raise ValueError("Unapproved source")
            while True:
                b=res.read(1024*1024)
                if not b:break
                count+=len(b)
                if count>a.max_bytes:raise ValueError("Image exceeds bound")
                out.write(b);digest.update(b)
        out.flush();os.fsync(out.fileno())
    if count<512 or digest.hexdigest()!=a.sha256:raise ValueError("Image digest mismatch")
    os.link(temp,a.output)
    print(json.dumps({"bytes":count,"sha256":digest.hexdigest(),"sourceHost":urllib.parse.urlsplit(a.url).hostname,"authorizedByClient":True}))
finally:
    temp.unlink(missing_ok=True)
