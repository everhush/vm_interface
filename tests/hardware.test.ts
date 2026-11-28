import { test } from "node:test";
import assert from "node:assert/strict";
import { coldHardwarePatch, hardwareSpec } from "../src/hardware";
import type { Resource } from "../src/kube";
const request = { cpu: 2, memoryMiB: 768, expectedResourceVersion: "101" };
const vm: Resource = {
  metadata: { uid: "stable-id", resourceVersion: "101" },
  spec: {
    runStrategy: "Halted",
    template: {
      spec: {
        domain: {
          cpu: { cores: 1 },
          resources: { requests: { memory: "512Mi" } },
          devices: { disks: [{ name: "boot" }] },
        },
      },
    },
  },
  status: { ready: false, created: false },
};
test("cold configuration is bounded, versioned and preserves unrelated storage/devices", () => {
  assert.deepEqual(coldHardwarePatch(vm, null, request), {
    metadata: { resourceVersion: "101" },
    spec: {
      template: {
        spec: {
          domain: {
            cpu: { cores: 2 },
            resources: { requests: { memory: "768Mi" } },
            memory: { guest: "768Mi" },
          },
        },
      },
    },
  });
  assert.equal(hardwareSpec.safeParse({ ...request, cpu: 100 }).success, false);
  assert.equal(hardwareSpec.safeParse({ ...request, hostPath: "/" }).success, false);
  assert.equal(hardwareSpec.safeParse({ ...request, memoryMiB: 0 }).success, false);
});
test("cold configuration rejects stale, running, transitioning and deleting VMs", () => {
  assert.throws(
    () => coldHardwarePatch(vm, null, { ...request, expectedResourceVersion: "100" }),
    /version changed/,
  );
  assert.throws(() => coldHardwarePatch(vm, { metadata: { uid: "vmi" } }, request), /Stop the VM/);
  assert.throws(
    () =>
      coldHardwarePatch(
        { ...vm, status: { stateChangeRequests: [{ action: "Start" }] } },
        null,
        request,
      ),
    /Stop the VM/,
  );
  assert.throws(
    () =>
      coldHardwarePatch(
        { ...vm, metadata: { ...vm.metadata, deletionTimestamp: "now" } },
        null,
        request,
      ),
    /unavailable/,
  );
  assert.throws(
    () => coldHardwarePatch({ ...vm, spec: { runStrategy: "Always" } }, null, request),
    /Stop the VM/,
  );
  assert.throws(
    () => coldHardwarePatch({ ...vm, spec: { runStrategy: "Halted" } }, null, request),
    /Unsupported hardware/,
  );
});
