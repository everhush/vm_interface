import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  addUsage,
  desiredUsage,
  emptyUsage,
  limits,
  requireCapacity,
  specUsage,
} from "../src/quota";
import { vmManifest, type ComputerSpec } from "../src/spec";
const s: ComputerSpec = {
  version: 1,
  name: "quota",
  architecture: "amd64",
  cpu: 4,
  memoryMiB: 4096,
  image: "cirros-smoke",
  storage: { systemGiB: 2, exchangeGiB: 1 },
};
test("desired reservations include halted VMs and persistent disk templates", () => {
  const requested = specUsage(s);
  assert.deepEqual(requested, { computers: 1, cpu: 4, memoryMiB: 4096, storageGiB: 3 });
  const vm = vmManifest("vm-" + "a".repeat(32), "alpha", s);
  assert.deepEqual(desiredUsage(vm.spec), requested);
  assert.deepEqual(addUsage(emptyUsage(), requested), requested);
});
test("every aggregate dimension is bounded and exact capacity is allowed", () => {
  assert.doesNotThrow(() => requireCapacity(limits));
  for (const k of Object.keys(limits) as (keyof typeof limits)[]) {
    assert.throws(() => requireCapacity({ ...limits, [k]: limits[k] + 1 }), /quota exceeded/);
  }
});
test("unrecognized resource quantities fail closed; canonical Gi memory works", () => {
  const vm = vmManifest("vm-" + "a".repeat(32), "alpha", s);
  vm.spec.template.spec.domain.resources.requests.memory = "4Gi";
  assert.equal(desiredUsage(vm.spec).memoryMiB, 4096);
  vm.spec.template.spec.domain.resources.requests.memory = "bad";
  assert.throws(() => desiredUsage(vm.spec), /Unrecognized/);
  assert.throws(() => desiredUsage({}), /Unrecognized/);
});
