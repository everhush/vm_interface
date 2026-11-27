import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { quantity, eligibleNodes } from "../scripts/kvm_capacity.ts";
test("canonical quantities", () => {
  for (const [raw, expected] of [
    ["1k", 1000],
    ["1000", 1000],
    ["1e3", 1000],
    ["1Ki", 1024],
    ["0", 0],
    ["500m", 0.5],
    ["2M", 2000000],
  ] as const)
    assert.equal(quantity(raw), expected);
});
test("invalid quantities", () => {
  for (const raw of ["", "1foo", "NaN", "1k2", "1e999"]) assert.throws(() => quantity(raw));
});
test("eligible ready schedulable KVM nodes", () => {
  const node = (name: string, count: string, ready = true, schedulable = true) => ({
    metadata: { name, labels: { "kubevirt.io/schedulable": String(schedulable) } },
    status: {
      allocatable: { "devices.kubevirt.io/kvm": count },
      conditions: [{ type: "Ready", status: ready ? "True" : "False" }],
    },
  });
  assert.deepEqual(
    eligibleNodes({
      items: [
        node("good", "1k"),
        node("zero", "0"),
        node("fraction", "500m"),
        node("almost", "1.0000000000000000001"),
        node("not-ready", "1k", false),
        node("unschedulable", "1k", true, false),
      ],
    }),
    [{ name: "good", kvm: "1000" }],
  );
  assert.deepEqual(eligibleNodes({ items: [] }), []);
});
