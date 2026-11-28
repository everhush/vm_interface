import { test } from "node:test";
import assert from "node:assert/strict";
import { vmManifest } from "../src/spec";
import { desiredUsage } from "../src/quota";
import {
  planGrowth,
  growthState,
  GROWTH_ANNOTATION,
  storageQuantityBytes,
} from "../src/storage-growth-layout";
import type { Resource } from "../src/kube";
const id = "vm-" + "a".repeat(32),
  claim = id + "-boot";
function fixture() {
  const v = vmManifest(id, "alpha", {
    version: 1,
    name: "growth",
    architecture: "amd64",
    cpu: 1,
    memoryMiB: 512,
    image: "cirros-smoke",
    storage: { systemGiB: 2, exchangeGiB: 1 },
  });
  const vm: Resource = { ...v, metadata: { ...v.metadata, uid: "vm-uid", resourceVersion: "1" } };
  const pvc: Resource = {
    metadata: { name: claim, uid: "pvc-uid", resourceVersion: "2" },
    spec: {
      storageClassName: "vm-expandable",
      volumeMode: "Filesystem",
      resources: { requests: { storage: "2Gi" } },
    },
    status: { phase: "Bound", capacity: { storage: "2Gi" } },
  };
  return { vm, pvc };
}
test("PVC growth reserves monotonic quota before patch, and resumes identical target without double charging", () => {
  const { vm, pvc } = fixture();
  const plan = planGrowth(vm, id, "system.disk", pvc, 4, "1");
  assert.equal(plan.delta, 2);
  assert.equal(plan.pvcPatch.spec.resources.requests.storage, "4Gi");
  const s = vm.spec as { template: { metadata: { annotations?: Record<string, string> } } };
  s.template.metadata.annotations = {
    ...s.template.metadata.annotations,
    ...plan.reservationPatch.spec.template.metadata.annotations,
  };
  assert.equal(desiredUsage(vm.spec).storageGiB, 5);
  assert.equal(growthState(vm, claim, pvc)?.submitted, false);
  const resume = planGrowth(vm, id, "system.disk", pvc, 4, "1");
  assert.equal(resume.delta, 0);
  assert.throws(() => planGrowth(vm, id, "system.disk", pvc, 5, "1"), /existing reservation/);
  assert.throws(() => planGrowth(vm, id, "system.disk", pvc, 3, "1"), /increase/);
  assert.throws(
    () =>
      planGrowth(
        vm,
        id,
        "system.disk",
        { ...pvc, metadata: { ...pvc.metadata, uid: "replacement" } },
        4,
        "1",
      ),
    /identity/,
  );
  const submitted = {
    ...pvc,
    spec: {
      storageClassName: "vm-expandable",
      volumeMode: "Filesystem",
      resources: { requests: { storage: "4Gi" } },
    },
  };
  assert.equal(planGrowth(vm, id, "system.disk", submitted, 4, "1").alreadySubmitted, true);
  assert.equal(growthState(vm, claim, submitted)?.pvcCapacityConverged, false);
  const grown = { ...submitted, status: { phase: "Bound", capacity: { storage: "4096Mi" } } };
  assert.equal(growthState(vm, claim, grown)?.pvcCapacityConverged, true);
  assert.equal(growthState(vm, claim, grown)?.guestFilesystemGrowthVerified, false);
});
test("growth refuses stale versions, foreign or missing reservations, unsupported storage and malformed capacity", () => {
  const { vm, pvc } = fixture();
  assert.throws(() => planGrowth(vm, id, "system.disk", pvc, 3, "stale"), /resource version/);
  assert.throws(
    () =>
      planGrowth(
        vm,
        id,
        "system.disk",
        { ...pvc, spec: { storageClassName: "local-path", volumeMode: "Filesystem" } },
        3,
        "1",
      ),
    /operator expansion/,
  );
  assert.throws(() => planGrowth(vm, id, "unknown", pvc, 3, "1"), /not found/);
  assert.throws(() => storageQuantityBytes("1.5Gi"), /Unrecognized/);
  const s = vm.spec as { template: { metadata: { annotations?: Record<string, string> } } };
  s.template.metadata.annotations = {
    [GROWTH_ANNOTATION]: JSON.stringify([
      { claim: id + "-foreign", sizeGiB: 4, pvcUid: "pvc-uid" },
    ]),
  };
  assert.throws(() => desiredUsage(vm.spec), /Unrecognized growth/);
});
