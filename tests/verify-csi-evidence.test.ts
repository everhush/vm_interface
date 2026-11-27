import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { capacity, digest, requireEvidence } from "../scripts/verify_csi_evidence.ts";
test("PVC capacity quantities", () => {
  assert.equal(capacity("8Gi"), 8 * 1024 ** 3);
  assert.equal(capacity("6828998001"), 6828998001);
  assert.throws(() => capacity("8GiB"));
});
test("failure and digest", () => {
  assert.notEqual(digest(Buffer.from("original")), digest(Buffer.from("tampered")));
  assert.throws(() => requireEvidence(false, "PVC identity changed"), /identity/);
});
