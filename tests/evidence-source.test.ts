import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { sourceIdentity } from "../scripts/verify-evidence.ts";
test("exact hosted and device run identities", () => {
  const commit = "a".repeat(40);
  assert.deepEqual(sourceIdentity({ commit, runId: "12345" }, commit), [commit, "12345"]);
  assert.deepEqual(sourceIdentity({ commit, runId: "device-20261126T100000Z-12" }, commit), [
    commit,
    "device-20261126T100000Z-12",
  ]);
  for (const proof of [
    {},
    { commit: "short", runId: "123" },
    { commit, runId: "unbound" },
    { commit: "b".repeat(40), runId: "123" },
  ])
    assert.throws(() => sourceIdentity(proof, commit));
});
