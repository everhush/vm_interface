/** API-driven state before and after an infrastructure-injected API pod restart. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { client, key, wait, writeJson } from "./api-client.ts";
const { call, B } = client({ timeout: 45 });
const observed = async (op: string) => {
  const x = await call("GET", "/operations/" + op);
  return x.observation?.state === "converged" ? x : null;
};
const poll = <T>(check: () => T | Promise<T>) =>
  wait(check, 420, "Recovery state did not converge", 3);
const statefile = process.env.RECOVERY_STATE_PATH ?? "/tmp/vm-recovery.json",
  mode = process.argv[2];
if (mode === "before") {
  const spec = {
      version: 1,
      name: "ci-recovery",
      architecture: "amd64",
      cpu: 1,
      memoryMiB: 512,
      image: "cirros-smoke",
    },
    createkey = key(),
    startkey = key();
  const created = await call("POST", "/computers", { body: spec, idem: createkey, expected: 202 }),
    path = "/computers/" + created.result.id;
  const started = await call("POST", path + "/start", { body: {}, idem: startkey, expected: 202 });
  const uid = await poll(async () => {
    const x = (await call("GET", path)).instance;
    return x && x.status.phase === "Running" ? x.metadata.uid : null;
  });
  await poll(() => observed(created.operationId));
  await poll(() => observed(started.operationId));
  writeFileSync(
    statefile,
    JSON.stringify({ spec, createkey, startkey, created, started, uid, path }),
    { mode: 0o600 },
  );
  chmodSync(statefile, 0o600);
} else if (mode === "after") {
  const state = JSON.parse(readFileSync(statefile, "utf8")),
    path = state.path;
  assert(/^\/computers\/vm-[a-f0-9]{32}$/.test(path), "Invalid recovery state");
  try {
    assert.deepEqual(
      await call("POST", "/computers", { body: state.spec, idem: state.createkey, expected: 202 }),
      state.created,
    );
    assert.deepEqual(
      await call("POST", path + "/start", { body: {}, idem: state.startkey, expected: 202 }),
      state.started,
    );
    assert.equal((await call("GET", path)).instance.metadata.uid, state.uid);
    assert.equal(
      (await call("GET", "/computers")).filter(
        (x: { id: string }) => x.id === state.created.result.id,
      ).length,
      1,
    );
    assert(await observed(state.started.operationId));
    const receipt = await call("GET", "/operations/by-key", { idem: state.startkey });
    assert.equal(receipt.id, state.started.operationId);
    assert.equal(receipt.status, "submitted");
    assert.deepEqual(receipt.result, state.started.result);
    await call("GET", "/operations/by-key", { token: B, idem: state.startkey, expected: 404 });
    await call("GET", "/operations/by-key", { idem: key(), expected: 404 });
    await call("GET", "/operations/by-key", { expected: 400 });
    assert(
      (await call("GET", "/operations")).some(
        (x: { id: string }) => x.id === state.started.operationId,
      ),
    );
    await call("GET", "/operations/" + state.started.operationId, { token: B, expected: 404 });
    const stopped = await call("POST", path + "/stop", { body: {}, idem: key(), expected: 202 });
    await poll(() => observed(stopped.operationId));
    const deleted = await call("DELETE", path, { idem: key(), expected: 202 });
    await poll(() => observed(deleted.operationId));
    mkdirSync("evidence", { recursive: true });
    writeJson("evidence/recovery-verification.json", {
      apiDeploymentRestart: true,
      sameInstanceUid: state.uid,
      idempotentCreateAndStart: true,
      durableOperationHistory: true,
      receiptByKeyAfterRestart: true,
      observedStopAndDelete: true,
      crossAccountDenied: true,
    });
    console.log(
      "Real API restart preserved VM identity, idempotency and durable convergence evidence",
    );
  } finally {
    try {
      await call("DELETE", path, { idem: key(), expected: 202 });
    } catch {
      /* best effort on an already deleted fixture */
    }
  }
} else throw Error("Expected before or after recovery phase");
