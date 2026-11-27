import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { WebSocket, createWebSocketStream } from "ws";
import { connect, Framebuffer, encodings, type RfbClient } from "rfb2";

const base = process.env.API_URL || "http://127.0.0.1:3000/api/v1";
const wss = process.env.VNC_URL || "wss://127.0.0.1:3443/api/v1";
const a = process.env.TOKEN_A,
  b = process.env.TOKEN_B;
assert.ok(a && b);
const ca = readFileSync(process.env.CONSOLE_CA_PATH || "/tmp/console-ca.pem");
async function call(method: string, path: string, token = a, data?: unknown, expected = 200) {
  const res = await fetch(base + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(res.status, expected, method + " " + path);
  return res.json();
}
function timeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("VNC test timeout")), ms);
    p.then(
      (x) => {
        clearTimeout(timer);
        resolve(x);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
function sock(path: string, token: string) {
  const s = new WebSocket(wss + path, ["binary", "vm-ticket." + token], {
    ca,
    handshakeTimeout: 15000,
    maxPayload: 16 * 1024 * 1024,
    perMessageDeflate: false,
  });
  s.on("error", () => {});
  return s;
}
async function denied(path: string, token: string, status: number) {
  const s = sock(path, token);
  try {
    await timeout(
      new Promise<void>((resolve, reject) => {
        s.once("unexpected-response", (_req, res) => {
          res.resume();
          try {
            assert.equal(res.statusCode, status);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
        s.once("open", () => reject(Error("Unexpected authorized connection")));
        s.once("error", reject);
      }),
    );
  } finally {
    s.terminate();
  }
}
type Viewer = { ws: WebSocket; client: RfbClient; frame: Framebuffer };
async function viewer(path: string, token: string): Promise<Viewer> {
  const ws = sock(path, token),
    stream = createWebSocketStream(ws);
  stream.on("error", () => {});
  try {
    const client = await timeout(
      connect({
        stream,
        security: [1],
        encodings: [encodings.raw, encodings.pseudoDesktopSize],
        pixelFormat: "bgrx",
        initialUpdate: false,
        timeout: 12000,
      }),
    );
    client.on("error", () => {});
    return { ws, client, frame: Framebuffer.attach(client) };
  } catch (e) {
    ws.terminate();
    throw e;
  }
}
async function frame(v: Viewer) {
  const next = v.client.nextUpdate();
  v.client.requestUpdate(false);
  const update = await timeout(next);
  assert.ok(update.rects.some((r) => r.type === "pixels"));
  const { width, height, data } = v.frame;
  assert.ok(width > 0 && height > 0 && data.length === width * height * 4);
  return { width, height, sha256: createHash("sha256").update(data).digest("hex") };
}
const spec = {
  version: 1,
  name: "ci-vnc",
  architecture: "amd64",
  cpu: 1,
  memoryMiB: 512,
  image: "cirros-smoke",
};
const created = await call("POST", "/computers", a, spec, 202);
const id = created.result.id as string,
  path = "/computers/" + id;
const viewers: Viewer[] = [];
try {
  await call("POST", path + "/start", a, {}, 202);
  let uid: string | undefined;
  for (let i = 0; i < 72; i++) {
    const state = await call("GET", path);
    if (state.instance?.status?.phase === "Running") {
      uid = state.instance.metadata.uid;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  assert.ok(uid);
  const screenshotGrant = await call(
    "POST",
    path + "/console-tickets",
    a,
    { scope: "screenshot-only" },
    201,
  );
  await denied(path + "/vnc", screenshotGrant.token, 403);
  await denied(path + "/vnc", "a".repeat(43), 401);
  await call("POST", path + "/console-tickets", b, { scope: "observe-vnc" }, 404);
  const first = await call("POST", path + "/console-tickets", a, { scope: "observe-vnc" }, 201);
  const second = await call("POST", path + "/console-tickets", a, { scope: "observe-vnc" }, 201);
  assert.equal(first.instanceUid, uid);
  assert.equal(second.instanceUid, uid);
  await denied("/computers/vm-" + "0".repeat(32) + "/vnc", first.token, 401);
  const one = await viewer(path + "/vnc", first.token);
  viewers.push(one);
  const firstFrame = await frame(one);
  const two = await viewer(path + "/vnc", second.token);
  viewers.push(two);
  const secondFrame = await frame(two);
  assert.equal(firstFrame.width, secondFrame.width);
  assert.equal(firstFrame.height, secondFrame.height);
  assert.equal((await frame(one)).width, firstFrame.width);
  const closed = new Promise<void>((resolve) => one.ws.once("close", () => resolve()));
  await call("DELETE", path + "/console-tickets/" + first.id);
  await timeout(closed, 10000);
  await denied(path + "/vnc", first.token, 401);
  const remaining = await frame(two);
  assert.equal(remaining.width, secondFrame.width);
  writeFileSync(
    "evidence/vnc-observers.json",
    JSON.stringify(
      {
        instanceUid: uid,
        firstFrame,
        secondFrame,
        remaining,
        sharedObservers: true,
        revocation: true,
        inputSupported: false,
      },
      null,
      2,
    ),
  );
  console.log("Real read-only RFB frames, shared observers, scope and revocation verified");
} finally {
  for (const v of viewers) {
    v.client.end();
    v.ws.terminate();
  }
  await call("DELETE", path, a, undefined, 202);
}
