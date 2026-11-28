import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { relayBinaryTunnel } from "../src/tunnel-relay";
async function pair() {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const incoming = once(server, "connection");
  const client = new WebSocket("ws://127.0.0.1:" + address.port);
  await once(client, "open");
  const [peer] = (await incoming) as [WebSocket];
  return { server, client, peer };
}
async function cleanup(...pairs: Awaited<ReturnType<typeof pair>>[]) {
  for (const p of pairs) {
    p.client.terminate();
    p.peer.terminate();
    await new Promise<void>((r) => p.server.close(() => r()));
  }
}
test(
  "native WebSocket relay preserves binary response queued before upstream EOF",
  { timeout: 8000 },
  async () => {
    const left = await pair(),
      right = await pair();
    let done = 0;
    const abort = relayBinaryTunnel(
      left.peer,
      right.peer,
      Date.now() + 10000,
      async () => true,
      () => done++,
    );
    try {
      const bytes = Buffer.from([0, 255, 13, 10, 1, 2]);
      const received = once(left.client, "message"),
        closed = once(left.client, "close");
      right.client.send(bytes, { binary: true });
      right.client.close(1000);
      const [data, binary] = await received;
      assert.equal(binary, true);
      assert.deepEqual(data, bytes);
      await closed;
    } finally {
      abort();
      await cleanup(left, right);
    }
    assert.equal(done, 1);
  },
);
test(
  "relay revocation closes both actual peers and releases reservation once",
  { timeout: 8000 },
  async () => {
    const left = await pair(),
      right = await pair();
    let done = 0;
    const abort = relayBinaryTunnel(
      left.peer,
      right.peer,
      Date.now() + 10000,
      async () => {
        throw Error("revoked");
      },
      () => done++,
    );
    try {
      await Promise.all([once(left.client, "close"), once(right.client, "close")]);
    } finally {
      abort();
      await cleanup(left, right);
    }
    assert.equal(done, 1);
  },
);

test(
  "closed downstream releases grant despite stalled upstream close",
  { timeout: 8000 },
  async () => {
    const left = await pair(),
      right = await pair();
    let done = 0,
      complete: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const abort = relayBinaryTunnel(
      left.peer,
      right.peer,
      Date.now() + 10000,
      async () => true,
      () => {
        done++;
        complete();
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      right.client.pause();
      left.client.close(1000);
      await Promise.race([
        released,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(Error("Grant reservation not released promptly")), 1500);
        }),
      ]);
      assert.equal(done, 1);
    } finally {
      if (timer) clearTimeout(timer);
      right.client.resume();
      abort();
      await cleanup(left, right);
    }
  },
);
