import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { serviceIp, relayServer, RelaySlots } from "../scripts/ci_loopback_relay.ts";
async function listen(s: Server) {
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const a = s.address();
  assert(a && typeof a !== "string");
  return a.port;
}
function close(s: Server) {
  return new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())));
}
async function reply(socket: Socket, payload: Buffer, halfClose: boolean) {
  const chunks: Buffer[] = [];
  socket.on("data", (b) => chunks.push(b));
  const ended = once(socket, "end");
  socket.setTimeout(5000, () => socket.destroy(Error("Timed out")));
  if (halfClose) socket.end(payload);
  else socket.write(payload);
  await ended;
  socket.destroy();
  return Buffer.concat(chunks);
}
test("loopback relay validates private service scope", () => {
  const spec = {
    type: "ClusterIP",
    clusterIP: "10.43.2.3",
    ports: [{ port: 3000 }, { port: 3443 }],
  };
  assert.equal(serviceIp({ spec }), spec.clusterIP);
  for (const clusterIP of ["8.8.8.8", "127.0.0.1", "169.254.1.1", "0.0.0.0"])
    assert.throws(() => serviceIp({ spec: { ...spec, clusterIP } }));
  assert.throws(() => serviceIp({ spec: { ...spec, type: "NodePort" } }));
});
test("aborted request does not break subsequent full and half-closed requests", async () => {
  const backend = createServer({ allowHalfOpen: true }, (s) => {
    const parts: Buffer[] = [];
    s.on("error", () => {});
    s.on("data", (b) => parts.push(b));
    s.on("end", () => s.end(Buffer.concat(parts).reverse()));
  });
  const slots = new RelaySlots(4),
    front = relayServer("127.0.0.1", await listen(backend), slots),
    port = await listen(front);
  try {
    const interrupted = createConnection({ port, host: "127.0.0.1" });
    interrupted.on("error", () => {});
    await once(interrupted, "connect");
    interrupted.write("interrupted");
    interrupted.destroy();
    for (const payload of [Buffer.from("test"), Buffer.alloc(150000, 120)])
      assert.deepEqual(
        await reply(createConnection({ port, host: "127.0.0.1" }), payload, true),
        Buffer.from(payload).reverse(),
      );
  } finally {
    await Promise.all([close(front), close(backend)]);
  }
});
test("early response releases slot without waiting for open client", async () => {
  const backend = createServer({ allowHalfOpen: true }, (s) => {
    s.on("error", () => {});
    s.once("data", () => {
      s.end("denied");
      s.destroySoon();
    });
  });
  const slots = new RelaySlots(1),
    front = relayServer("127.0.0.1", await listen(backend), slots),
    port = await listen(front);
  try {
    for (let i = 0; i < 3; i++) {
      const s = createConnection({ port, host: "127.0.0.1" });
      assert.equal((await reply(s, Buffer.from("x"), false)).toString(), "denied");
      for (let j = 0; slots.active && j < 30; j++) await delay(10);
      assert.equal(slots.active, 0);
    }
  } finally {
    await Promise.all([close(front), close(backend)]);
  }
});
