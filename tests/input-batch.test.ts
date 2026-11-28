import { test } from "node:test";
import assert from "node:assert/strict";
import { batchSpec, validateBatchGeometry } from "../src/input-batch";
test("input batches are bounded strict and validated before sending", () => {
  const batch = batchSpec.parse({
    events: [
      { type: "key", keysym: 65, down: true },
      { type: "key", keysym: 65, down: false },
      { type: "pointer", x: 30, y: 40, buttons: 0 },
    ],
  });
  assert.doesNotThrow(() => validateBatchGeometry(batch, 640, 480));
  assert.throws(() => validateBatchGeometry(batch, 30, 40), /outside/);
  assert.equal(batchSpec.safeParse({ events: [] }).success, false);
  assert.equal(
    batchSpec.safeParse({ events: Array(65).fill({ type: "key", keysym: 65, down: true }) })
      .success,
    false,
  );
  assert.equal(batchSpec.safeParse({ events: [{ type: "clipboard", text: "x" }] }).success, false);
  assert.equal(
    batchSpec.safeParse({ events: [{ type: "pointer", x: 0, y: 0, buttons: 256 }] }).success,
    false,
  );
  assert.throws(
    () =>
      validateBatchGeometry(
        batchSpec.parse({
          events: Array.from({ length: 33 }, (_, keysym) => ({ type: "key", keysym, down: true })),
        }),
        640,
        480,
      ),
    /simultaneous/,
  );
});
