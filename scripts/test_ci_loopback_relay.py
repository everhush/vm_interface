import asyncio
import unittest
from ci_loopback_relay import service_ip,relay

class RelayTests(unittest.IsolatedAsyncioTestCase):
    def test_scope(self):
        doc={"spec":{"type":"ClusterIP","clusterIP":"10.43.2.3","ports":[{"port":3000},{"port":3443}]}}
        self.assertEqual(service_ip(doc),"10.43.2.3")
        for ip in ("8.8.8.8","127.0.0.1","169.254.1.1","0.0.0.0"):
            with self.assertRaises(ValueError):service_ip({"spec":{**doc["spec"],"clusterIP":ip}})
        with self.assertRaises(ValueError):service_ip({"spec":{**doc["spec"],"type":"NodePort"}})

    async def test_aborted_connection_does_not_break_next_request(self):
        async def echo(r,w):
            try:
                value=await r.read()
                w.write(value[::-1]);await w.drain()
            except ConnectionError:pass
            finally:w.close();await w.wait_closed()
        backend=await asyncio.start_server(echo,"127.0.0.1",0)
        port=backend.sockets[0].getsockname()[1]
        slots=asyncio.Semaphore(4)
        front=await asyncio.start_server(lambda r,w:relay(r,w,"127.0.0.1",port,slots),"127.0.0.1",0)
        local=front.sockets[0].getsockname()[1]
        try:
            _,w=await asyncio.open_connection("127.0.0.1",local)
            w.write(b"interrupted");await w.drain();w.transport.abort()
            for payload in (b"test",b"x"*150000):
                r,w=await asyncio.open_connection("127.0.0.1",local)
                w.write(payload);await w.drain();w.write_eof()
                self.assertEqual(await asyncio.wait_for(r.read(),5),payload[::-1])
                w.close();await w.wait_closed()
            await asyncio.sleep(0.05)
        finally:
            front.close();backend.close()
            await front.wait_closed();await backend.wait_closed()
