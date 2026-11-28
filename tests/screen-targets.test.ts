import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTarget } from "../scripts/screen-targets.ts";
const HEADER =
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n";
const ROW =
  "5\t1\t1\t1\t1\t1\t10\t20\t40\t20\t95\tCompute\n5\t1\t1\t1\t1\t2\t55\t20\t30\t20\t95\tproof\n";
test("unique exact label", () => {
  assert.deepEqual(parseTarget(HEADER + ROW, "Compute proof", 100, 100), [47, 30]);
  assert.equal(parseTarget(HEADER + ROW, "Compute", 100, 100), null);
});
test("duplicate, low confidence and out of bounds", () => {
  assert.equal(
    parseTarget(HEADER + ROW + ROW.replaceAll("5\t1\t1\t", "5\t1\t2\t"), "Compute proof", 100, 100),
    null,
  );
  assert.equal(parseTarget(HEADER + ROW.replaceAll("95", "10"), "Compute proof", 100, 100), null);
  assert.throws(() => parseTarget(HEADER + ROW, "Compute proof", 60, 100));
});
