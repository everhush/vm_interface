import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { boundedBody, boundedText, discardUnreadBody, unreadMediaLimit } from "../src/request-body";
import { createServer, request } from "node:http";
import { Readable } from "node:stream";
test("body limits use actual UTF-8 bytes and reject oversized requests", async () => {
  const req = (body: string) => new Request("http://test/", { method: "POST", body });
  assert.equal(await boundedText(req("abc"), 3), "abc");
  await assert.rejects(boundedBody(req("éé"), 3), { status: 413 });
  await assert.rejects(
    boundedBody(
      new Request("http://test/", {
        method: "POST",
        body: "a",
        headers: { "content-length": "4" },
      }),
      3,
    ),
    { status: 413 },
  );
});
test("stalled streams are cancelled at deadline", async () => {
  const req = new Request("http://test/", {
    method: "POST",
    body: new ReadableStream({
      start() {
        /* deliberately never produce data */
      },
    }),
    duplex: "half",
  } as RequestInit);
  await assert.rejects(boundedBody(req, 10, 20), { status: 400 });
});

test("media response drain scope and limits", async () => {
  const base = "http://test/api/v1/";
  const options = {
    method: "PUT",
    body: "abc",
    headers: { "content-type": "application/octet-stream" },
  };
  const artifact = new Request(base + "media-artifacts/" + "a".repeat(36) + "/file", options);
  assert.equal(unreadMediaLimit(artifact), 64 * 1024 * 1024);
  await discardUnreadBody(artifact, 3);
  assert.equal(artifact.bodyUsed, true);
  assert.equal(
    unreadMediaLimit(
      new Request(base + "computers/vm-" + "b".repeat(32) + "/media/boot/chunks", options),
    ),
    8 * 1024 * 1024,
  );
  assert.equal(unreadMediaLimit(new Request(base + "other", options)), 0);
  await assert.rejects(discardUnreadBody(new Request(base + "other", options), 2), { status: 413 });
  const stalled = new Request(base + "other", {
    method: "PUT",
    body: new ReadableStream({ start() {} }),
    duplex: "half",
  } as RequestInit);
  await assert.rejects(discardUnreadBody(stalled, 10, 20), { status: 400 });
});
test(
  "real HTTP large replay and denial return complete response after drain",
  { timeout: 15000 },
  async () => {
    const server = createServer((incoming, outgoing) => {
      void (async () => {
        const r = new Request("http://test" + incoming.url, {
          method: "PUT",
          headers: incoming.headers as HeadersInit,
          body: Readable.toWeb(incoming),
          duplex: "half",
        } as RequestInit);
        const status = incoming.url?.endsWith("/chunks") ? 404 : 202;
        await discardUnreadBody(r, unreadMediaLimit(r));
        const body = JSON.stringify({ status });
        outgoing.writeHead(status, {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          connection: "close",
        });
        outgoing.end(body);
      })().catch(() => outgoing.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      for (const [path, size, expected] of [
        ["/api/v1/media-artifacts/" + "a".repeat(36) + "/file", 21692416, 202],
        ["/api/v1/computers/vm-" + "b".repeat(32) + "/media/boot/chunks", 8 * 1024 * 1024, 404],
      ] as const) {
        const result = await new Promise<{ code: number | undefined; body: string }>(
          (resolve, reject) => {
            const req = request(
              {
                host: "127.0.0.1",
                port: address.port,
                path,
                method: "PUT",
                headers: {
                  "content-type": "application/octet-stream",
                  "content-length": size,
                  connection: "close",
                },
              },
              (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(c));
                res.on("error", reject);
                res.on("end", () =>
                  resolve({ code: res.statusCode, body: Buffer.concat(chunks).toString() }),
                );
              },
            );
            req.on("error", reject);
            req.end(Buffer.alloc(size, 42));
          },
        );
        assert.equal(result.code, expected);
        assert.deepEqual(JSON.parse(result.body), { status: expected });
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
