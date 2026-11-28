import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingSpec, recordingPath, RECORDING_DIR } from "../src/recordings";
test("capture requires explicit consent and bounded duration", () => {
  assert.equal(recordingSpec.safeParse({ consent: false }).success, false);
  assert.equal(recordingSpec.safeParse({}).success, false);
  assert.equal(recordingSpec.safeParse({ consent: true, maxSeconds: 121 }).success, false);
  assert.equal(recordingSpec.parse({ consent: true }).maxSeconds, 30);
});
test("artifact names are generated UUIDs, never user paths", () => {
  assert.throws(() => recordingPath("../../etc/passwd"), { status: 404 });
  const id = "12345678-1234-1234-1234-123456789abc";
  assert.equal(recordingPath(id), RECORDING_DIR + "/" + id + ".mp4");
});
