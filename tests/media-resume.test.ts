import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chunkLength, validateChunk, readChunk } from "../src/media-resume";
import { mediaChunkBytes } from "../src/media-config";
test("bounded chunks align, final chunk can be shorter, and hash must match", () => {
  const total = mediaChunkBytes + 3;
  assert.equal(chunkLength(total, 0), mediaChunkBytes);
  assert.equal(chunkLength(total, mediaChunkBytes), 3);
  for (const bad of [-1, 1, total, NaN])
    assert.throws(() => chunkLength(total, bad), { status: 422 });
  const b = Buffer.from("abc"),
    sha = createHash("sha256").update(b).digest("hex");
  assert.doesNotThrow(() => validateChunk(total, mediaChunkBytes, b, sha));
  assert.throws(() => validateChunk(total, mediaChunkBytes, Buffer.from("bad"), sha), {
    status: 422,
  });
});
test("bounded body read rejects overrun and incomplete data", async () => {
  const stream = (b: string) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Buffer.from(b));
        c.close();
      },
    });
  assert.deepEqual(await readChunk(stream("abc"), 3), Buffer.from("abc"));
  await assert.rejects(readChunk(stream("abcd"), 3), { status: 413 });
  await assert.rejects(readChunk(stream("ab"), 3), { status: 422 });
});
