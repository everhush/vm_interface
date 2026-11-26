import hashlib
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from media_http import binary_request

class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args):pass
    def reply(self,status,data):
        raw=json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Content-Type","application/json")
        self.send_header("Connection","close")
        self.end_headers()
        self.wfile.write(raw)
        self.close_connection=True
    def handle_expect_100(self):
        if self.path=="/denied":
            self.reply(404,{"error":"not found"});return False
        return super().handle_expect_100()
    def do_PUT(self):
        if self.path=="/early":
            self.reply(409,{"error":"immutable"});return
        raw=self.rfile.read(int(self.headers["Content-Length"]))
        self.reply(202,{"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)})

class MediaHTTPTests(unittest.TestCase):
    def test_full_body_and_early_response(self):
        server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            url="http://127.0.0.1:"+str(server.server_port)
            raw=b"z"*(12*1024*1024)
            h={"Authorization":"Bearer test","Content-Type":"application/octet-stream","Connection":"close"}
            for path,expected in (("/denied",404),("/early",409),("/valid",202)):
                status,body=binary_request(url+path,"PUT",h,raw)
                self.assertEqual(status,expected)
                if expected==202:self.assertEqual(json.loads(body),{"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)})
        finally:
            server.shutdown();server.server_close();thread.join()
