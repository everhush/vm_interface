import { test } from "node:test";
import assert from "node:assert/strict";
import { requireOwnedRunningInstance, validateScreenshot } from "../src/screenshot";
import type { Resource } from "../src/kube";
const vm: Resource = { metadata: { uid: "vm-uid" } };
const vmi: Resource = {
  metadata: {
    uid: "instance-uid",
    labels: { "vm-interface.io/account": "alpha" },
    ownerReferences: [{ kind: "VirtualMachine", uid: "vm-uid" }],
  },
  status: { phase: "Running" },
};
test("only the owned current running instance can be captured", () => {
  assert.equal(requireOwnedRunningInstance(vm, vmi, "alpha"), "instance-uid");
  assert.throws(() => requireOwnedRunningInstance(vm, vmi, "beta"), /No owned/);
  assert.throws(
    () => requireOwnedRunningInstance({ metadata: { uid: "other" } }, vmi, "alpha"),
    /No owned/,
  );
  assert.throws(
    () => requireOwnedRunningInstance(vm, { ...vmi, status: { phase: "Pending" } }, "alpha"),
    /No owned/,
  );
  assert.throws(
    () =>
      requireOwnedRunningInstance(
        vm,
        { ...vmi, metadata: { ...vmi.metadata, deletionTimestamp: "now" } },
        "alpha",
      ),
    /No owned/,
  );
});
test("screenshot checks PNG envelope and bounded dimensions", () => {
  const png = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  png.write("IEND", 37);
  assert.deepEqual(validateScreenshot(png), { width: 640, height: 480 });
  assert.throws(() => validateScreenshot(Buffer.from("not PNG")), /Invalid/);
  png.writeUInt32BE(100000, 16);
  assert.throws(() => validateScreenshot(png), /Invalid/);
});
