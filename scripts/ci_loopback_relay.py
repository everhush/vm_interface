"""Disposable CI-only loopback TCP relay to fixed Kubernetes ClusterIP.
Avoid kubectl port-forward's per-process failure on an aborted connection.
Never inspect application bytes, modify authentication, or replay a request.
"""
import argparse
import asyncio
import ipaddress
import json
import sys

PORTS=(3000,3443)

def service_ip(document):
    spec=document["spec"]
    if spec.get("type","ClusterIP")!="ClusterIP" or spec.get("externalIPs") or spec.get("externalName"):
        raise ValueError("Expected private ClusterIP service")
    ip=ipaddress.ip_address(spec["clusterIP"])
    if not ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
        raise ValueError("Expected private routable cluster IP")
    if {p["port"] for p in spec["ports"]}!=set(PORTS):
        raise ValueError("Unexpected service ports")
    return str(ip)

async def pump(reader,writer):
    while True:
        data=await asyncio.wait_for(reader.read(65536),timeout=600)
        if not data:
            if writer.can_write_eof():
                writer.write_eof()
                await writer.drain()
            return
        writer.write(data)
        await asyncio.wait_for(writer.drain(),timeout=30)

async def relay(reader,writer,host,port,slots):
    upstream=None
    tasks=[]
    if slots.locked():
        writer.close()
        await writer.wait_closed()
        return
    async with slots:
        try:
            incoming,upstream=await asyncio.wait_for(asyncio.open_connection(host,port),timeout=10)
            tasks=[asyncio.create_task(pump(reader,upstream)),asyncio.create_task(pump(incoming,writer))]
            # Upstream EOF ends this exchange after the response is flushed.
            # A client half-close, however, must still permit the full reply.
            done,_=await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
            if tasks[1] not in done:
                await tasks[0]
                await tasks[1]
            else:
                await tasks[1]
        except (ConnectionError,TimeoutError,OSError):
            pass
        finally:
            for task in tasks:task.cancel()
            if tasks:await asyncio.gather(*tasks,return_exceptions=True)
            for stream in (writer,upstream):
                if stream:
                    stream.close()
                    try:await asyncio.wait_for(stream.wait_closed(),timeout=5)
                    except (ConnectionError,TimeoutError,OSError):pass

async def main(host):
    slots=asyncio.Semaphore(64)
    servers=[]
    try:
        for port in PORTS:
            servers.append(await asyncio.start_server(lambda r,w,p=port:relay(r,w,host,p,slots),"127.0.0.1",port,backlog=64))
        print("Disposable loopback relays ready",flush=True)
        await asyncio.gather(*(s.serve_forever() for s in servers))
    finally:
        for s in servers:s.close()
        await asyncio.gather(*(s.wait_closed() for s in servers))

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-json",required=True)
    args=parser.parse_args()
    with open(args.service_json) as f:host=service_ip(json.load(f))
    try:asyncio.run(main(host))
    except KeyboardInterrupt:sys.exit(0)
