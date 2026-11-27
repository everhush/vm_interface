/** Client-side loopback TCP adapter for one account-authorized WSS grant.
 * No cluster credentials, unauthenticated external listener, or TLS bypass. */
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocket, createWebSocketStream } from "ws";
export async function startGuestRelay(address: string, token: string, ca: Buffer) {
  const url = new URL(address);
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/api\/v1\/computers\/vm-[a-f0-9]{32}\/exposures\/[a-f0-9-]{36}\/connect$/.test(
      url.pathname,
    ) ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    throw Error("Invalid private tunnel grant");
  let active: (() => void) | undefined;
  const server = createServer((socket) => {
    if (active) {
      socket.destroy();
      return;
    }
    socket.pause();
    const ws = new WebSocket(url, ["binary", "vm-network." + token], {
      ca,
      rejectUnauthorized: true,
      handshakeTimeout: 15000,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    });
    let closed = false,
      opened = false,
      drain: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (drain) clearTimeout(drain);
      active = undefined;
      socket.destroy();
      ws.terminate();
    };
    active = close;
    socket.on("error", close);
    socket.on("close", close);
    ws.on("error", close);
    ws.on("close", (code) => {
      // Abnormal transport loss/revocation aborts immediately. On a received
      // close frame, the WS stream will end its TCP writable peer after draining
      // already-authorized bytes; do not destroy that peer before it flushes.
      if (!opened || code === 1006) {
        close();
        return;
      }
      if (!closed) drain = setTimeout(close, 3000);
    });
    ws.on("open", () => {
      if (closed) return;
      opened = true;
      const stream = createWebSocketStream(ws);
      stream.on("error", close);
      socket.pipe(stream, { end: false });
      stream.pipe(socket);
      socket.resume();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const bound = server.address();
  if (!bound || typeof bound === "string") throw Error("Relay did not bind to TCP");
  return {
    port: bound.port,
    close: () => {
      active?.();
      return new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = await startGuestRelay(
    process.env.GUEST_RELAY_URL ?? "",
    process.env.GUEST_RELAY_TOKEN ?? "",
    readFileSync(process.env.CONSOLE_CA_PATH ?? ""),
  );
  console.log(JSON.stringify({ port: relay.port }));
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void relay.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
}
