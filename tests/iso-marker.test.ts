import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePgm, cropForOcr, exactMarker } from "../scripts/iso-marker.ts";
test("exact and not fuzzy", () => {
  assert(exactMarker("ISO BOOT PROOF PASSED"));
  assert(!exactMarker("ISO BOOT PROOF FAILED"));
  assert(!exactMarker("ISO BOOT PROOF PASSE"));
});
test("real pixel transform", () => {
  const raw = Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.from([0, 0, 0, 0, 255, 0])]);
  const scaled = cropForOcr(...parsePgm(raw));
  assert(scaled);
  const [cw, ch, pixels] = parsePgm(scaled);
  assert.deepEqual([cw, ch], [45, 45]);
  assert.deepEqual(pixels.subarray(20 * cw + 20, 20 * cw + 25), Buffer.alloc(5));
  assert.deepEqual(pixels.subarray(0, cw), Buffer.alloc(cw, 255));
  assert.equal(cropForOcr(2, 2, Buffer.alloc(4)), null);
  assert.throws(() => parsePgm(Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.alloc(5)])));
});
