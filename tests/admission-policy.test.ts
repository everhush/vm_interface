import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("data disk policy is a complete document pair", () => {
  const raw = readFileSync(new URL("../infra/exchange-policy.yaml", import.meta.url), "utf8");
  const disk = raw.split("\n---\n").filter((x) => x.includes("\n  name: vm-data-disk\n"));
  assert.equal(disk.length, 2);
  assert.equal(disk.filter((x) => x.includes("kind: ValidatingAdmissionPolicy\n")).length, 1);
  assert.equal(
    disk.filter((x) => x.includes("kind: ValidatingAdmissionPolicyBinding\n")).length,
    1,
  );
  assert.ok(disk[0].includes("[a-z0-9])?$')))"));
  assert.ok(disk[0].includes("!has(object.spec.sourceRef)"));
  assert.ok(disk[0].includes("object.spec.source.pvc.namespace == request.namespace"));
  assert.ok(disk[1].endsWith("  validationActions: [Deny]\n"));
});
test("growth policy retains dynamic PVC resource checks and fails closed", () => {
  const raw = readFileSync(new URL("../infra/storage-growth.yaml", import.meta.url), "utf8");
  for (const s of [
    "failurePolicy: Fail",
    "validationActions: [Deny]",
    "size(dyn(object.spec.resources).requests) == 1",
    "quantity(dyn(object.spec.resources).requests['storage']).compareTo(quantity(dyn(oldObject.spec.resources).requests['storage'])) > 0",
    "!has(dyn(object.spec.resources).limits)",
  ])
    assert.ok(raw.includes(s));
});

test("exchange broker admission requires the exact Vite+ loader and only its scoped token plus fixed compile-cache setting", () => {
  const raw = readFileSync(new URL("../infra/exchange-policy.yaml", import.meta.url), "utf8");
  for (const expected of [
    "['node','--import','vite-plus/register','src/run-exchange-broker.ts']",
    "size(c.env) == 2",
    "c.env[1].name == 'NODE_DISABLE_COMPILE_CACHE'",
    "c.env[1].value == '1'",
    "!has(c.env[1].valueFrom)",
    "c.env[0].name == 'EXCHANGE_TOKEN'",
    "!has(c.env[0].valueFrom)",
    "!has(c.envFrom)",
    "c.securityContext.readOnlyRootFilesystem",
    "failurePolicy: Fail",
    "validationActions: [Deny]",
  ])
    assert.ok(raw.includes(expected), expected);
});
