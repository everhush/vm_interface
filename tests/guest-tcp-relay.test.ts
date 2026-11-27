import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { connect } from "node:net";
import { WebSocketServer } from "ws";
import { startGuestRelay } from "../scripts/guest-tcp-relay";
test("loopback client relay verifies TLS and carries actual binary TCP bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "vm-relay-"));
  const key = join(root, "key"),
    cert = join(root, "cert");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  const ca = readFileSync(cert),
    token = "a".repeat(43),
    path = "/api/v1/computers/vm-" + "b".repeat(32) + "/exposures/" + "c".repeat(36) + "/connect";
  const server = createServer({ key: readFileSync(key), cert: ca });
  const wss = new WebSocketServer({
    server,
    handleProtocols: (p) => (p.has("binary") ? "binary" : false),
  });
  let received = false;
  const remoteReply = Buffer.alloc(512 * 1024, 0x5a);
  wss.on("connection", (ws, req) => {
    assert.equal(req.url, path);
    assert.ok(req.headers["sec-websocket-protocol"]?.includes("vm-network." + token));
    ws.on("message", (data) => {
      received = true;
      if (data.toString() === "close-after-reply") {
        ws.send(remoteReply, { binary: true });
        ws.close(1000);
      } else ws.send(data);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  const url = "wss://127.0.0.1:" + bound.port + path;
  const relay = await startGuestRelay(url, token, ca);
  try {
    await assert.rejects(() => startGuestRelay(url.replace("wss:", "ws:"), token, ca), /Invalid/);
    const data = Buffer.from([0, 1, 2, 255, 13, 10]);
    const result = await new Promise<Buffer>((resolve, reject) => {
      const s = connect(relay.port, "127.0.0.1", () => s.write(data));
      const timer = setTimeout(() => {
        s.destroy();
        reject(Error("Relay timeout"));
      }, 5000);
      const chunks: Buffer[] = [];
      s.on("data", (chunk) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length >= data.length) {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks));
          s.destroy();
        }
      });
      s.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    assert.ok(received);
    assert.deepEqual(result, data);
    // Use a fresh local listener (same authorized WSS route); the actual
    // peer sends binary data immediately followed by a close frame.
    const draining = await startGuestRelay(url, token, ca);
    try {
      const flushed = await new Promise<Buffer>((resolve, reject) => {
        const s = connect(draining.port, "127.0.0.1", () => s.write("close-after-reply"));
        const timer = setTimeout(() => {
          s.destroy();
          reject(Error("Relay close-drain timeout"));
        }, 5000);
        const chunks: Buffer[] = [];
        s.on("data", (chunk) => chunks.push(chunk));
        s.on("end", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks));
        });
        s.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      assert.deepEqual(flushed, remoteReply);
    } finally {
      await draining.close();
    }
  } finally {
    await relay.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
