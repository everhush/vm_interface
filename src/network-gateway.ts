import { readFileSync } from "node:fs";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { relayBinaryTunnel } from "./tunnel-relay";
import { lookupExposure, networkToken } from "./network";
import { ApiError } from "./kube";
const active = new Set<string>();
const MAX_TUNNELS = 8;
const pattern = /^\/api\/v1\/computers\/(vm-[a-f0-9]{32})\/exposures\/([a-f0-9-]{36})\/connect$/;
export function isExposurePath(path: string) {
  return pattern.test(path);
}
function reject(socket: Duplex, status: number) {
  if (!socket.destroyed)
    socket.end(
      "HTTP/1.1 " + status + " Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
}
export async function handleNetworkUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: WebSocketServer,
) {
  let upstream: WebSocket | undefined, reservation: string | undefined;
  try {
    const m = pattern.exec(req.url ?? "");
    if (!m) throw new ApiError(404, "Network route not found");
    const origin = req.headers.origin;
    if (origin && origin !== process.env.CONSOLE_ALLOWED_ORIGIN)
      throw new ApiError(403, "Origin denied");
    const protocols =
      typeof req.headers["sec-websocket-protocol"] === "string"
        ? req.headers["sec-websocket-protocol"].split(",").map((x) => x.trim())
        : [];
    if (!protocols.includes("binary")) throw new ApiError(400, "Binary subprotocol required");
    const token = networkToken(req.headers.authorization ?? null, protocols);
    if (!token) throw new ApiError(401, "Network grant required");
    const [computerId, grantId] = [m[1], m[2]];
    const grant = await lookupExposure(grantId, computerId, token);
    if (active.size >= MAX_TUNNELS || active.has(grant.id))
      throw new ApiError(409, "Tunnel connection limit exceeded");
    active.add(grant.id);
    reservation = grant.id;
    const dir = "/var/run/secrets/kubernetes.io/serviceaccount/";
    const ns = process.env.VM_NAMESPACE || "vm-interface";
    const url =
      "wss://kubernetes.default.svc/apis/subresources.kubevirt.io/v1/namespaces/" +
      ns +
      "/virtualmachineinstances/" +
      computerId +
      "/portforward/" +
      grant.port +
      "/tcp";
    upstream = new WebSocket(url, "plain.kubevirt.io", {
      ca: readFileSync(dir + "ca.crt"),
      headers: { authorization: "Bearer " + readFileSync(dir + "token", "utf8").trim() },
      handshakeTimeout: 10000,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    });
    upstream.on("error", () => {});
    const source = upstream;
    await new Promise<void>((resolve, reject) => {
      source.once("open", () => {
        source.pause();
        resolve();
      });
      source.once("error", reject);
      source.once("close", () => reject(Error("Guest tunnel closed")));
      source.once("unexpected-response", (_req, res) => {
        const status = res.statusCode;
        res.resume();
        console.warn("Private tunnel upstream rejected", status);
        reject(new ApiError(502, "Guest TCP tunnel unavailable"));
      });
    });
    await lookupExposure(grantId, computerId, token);
    if (socket.destroyed || source.readyState !== WebSocket.OPEN)
      throw new ApiError(502, "Tunnel unavailable");
    let attached = false;
    wss.handleUpgrade(req, socket, head, (client) => {
      attached = true;
      relayBinaryTunnel(
        client,
        source,
        grant.expiresAt.getTime(),
        () => lookupExposure(grantId, computerId, token),
        () => active.delete(grant.id),
      );
      source.resume();
    });
    if (!attached) throw new ApiError(502, "Tunnel client handshake failed");
    // ownership transferred to the live tunnel.
    reservation = undefined;
    upstream = undefined;
  } catch (e) {
    if (reservation) active.delete(reservation);
    upstream?.terminate();
    reject(socket, e instanceof ApiError ? e.status : 502);
  }
}
