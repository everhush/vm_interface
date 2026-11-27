/** Disposable loopback relay to an explicitly private ClusterIP. Never replays requests. */
import { createServer, createConnection, isIP, type Socket, type Server } from "node:net";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isMain } from "./tooling.ts";
const PORTS = [3000, 3443];
export function serviceIp(document: {
  spec: {
    type?: string;
    externalIPs?: string[];
    externalName?: string;
    clusterIP: string;
    ports: { port: number }[];
  };
}) {
  const s = document.spec;
  if ((s.type ?? "ClusterIP") !== "ClusterIP" || s.externalIPs?.length || s.externalName)
    throw Error("Expected private ClusterIP service");
  const ip = s.clusterIP,
    [a, b] = ip.split(".").map(Number);
  const private4 =
    isIP(ip) === 4 && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  const private6 = isIP(ip) === 6 && /^f[cd]/i.test(ip);
  if (!private4 && !private6) throw Error("Expected private routable cluster IP");
  if ([...new Set(s.ports.map((p) => p.port))].sort((a, b) => a - b).join(",") !== PORTS.join(","))
    throw Error("Unexpected service ports");
  return ip;
}
export class RelaySlots {
  active = 0;
  readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
}
export function relay(client: Socket, host: string, port: number, slots: RelaySlots) {
  client.on("error", () => {}); // Isolate aborted connections.
  if (slots.active >= slots.limit) {
    client.destroy();
    return;
  }
  slots.active++;
  const upstream = createConnection({ host, port, allowHalfOpen: true });
  let closed = false,
    upstreamEof = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    clearTimeout(grace);
    clearTimeout(backpressure);
    client.destroy();
    upstream.destroy();
    slots.active--;
  };
  const connectTimer = setTimeout(finish, 10000);
  let grace: ReturnType<typeof setTimeout> | undefined;
  let backpressure: ReturnType<typeof setTimeout> | undefined;
  function boundDrain(socket: Socket) {
    if (socket.writableNeedDrain) {
      clearTimeout(backpressure);
      backpressure = setTimeout(finish, 30000);
    }
  }
  client.setTimeout(600000, finish);
  upstream.setTimeout(600000, finish);
  upstream.on("connect", () => clearTimeout(connectTimer));
  client.on("data", () => boundDrain(upstream));
  upstream.on("data", () => boundDrain(client));
  upstream.on("drain", () => clearTimeout(backpressure));
  client.on("drain", () => clearTimeout(backpressure));
  client.pipe(upstream, { end: false });
  upstream.pipe(client, { end: false });
  client.on("end", () => upstream.end());
  upstream.on("end", () => {
    upstreamEof = true;
    client.unpipe(upstream);
    // end waits for queued response bytes; destroy only once writable side finishes.
    client.end();
    client.once("finish", finish);
    if (client.writableFinished) finish();
    else {
      clearTimeout(grace);
      grace = setTimeout(finish, 5000);
    }
  });
  upstream.on("error", () => {
    if (!upstreamEof) {
      client.unpipe(upstream);
      clearTimeout(grace);
      grace = setTimeout(finish, 5000);
      client.end();
    }
  });
  client.on("close", finish);
  upstream.on("close", () => {
    if (!upstreamEof) {
      client.end();
      clearTimeout(grace);
      grace = setTimeout(finish, 5000);
    }
  });
}
export function relayServer(host: string, port: number, slots: RelaySlots): Server {
  return createServer({ allowHalfOpen: true }, (s) => relay(s, host, port, slots));
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { "service-json": { type: "string" } } });
  if (!values["service-json"]) throw Error("--service-json required");
  const host = serviceIp(JSON.parse(readFileSync(values["service-json"], "utf8")));
  const slots = new RelaySlots(64);
  for (const port of PORTS)
    relayServer(host, port, slots).listen(port, "127.0.0.1", 64, () =>
      console.log("Disposable loopback relay ready", port),
    );
}
