/** Real API-only idle-stop and redacted audit conformance. */
import assert from "node:assert/strict";
import { client, wait, sleep, writeJson } from "./api-client.ts";
const OUT = "evidence/idle-proof",
  { call, B } = client({ out: OUT, automaticKeys: true });
const vm = await call("POST", "/computers", {
  body: {
    version: 1,
    name: "ci-idle",
    architecture: "amd64",
    cpu: 1,
    memoryMiB: 512,
    image: "cirros-smoke",
    idleStopSeconds: 60,
  },
  expected: 202,
});
const id = vm.result.id,
  path = "/computers/" + id;
try {
  await call("POST", path + "/start", { body: {}, expected: 202 });
  await wait(
    async () => (await call("GET", path)).instance?.status?.phase === "Running",
    420,
    "Idle test guest not Running",
  );
  await wait(async () => (await call("GET", path)).status?.ready === true, 90, "Guest not ready");
  const ticket = await call("POST", path + "/console-tickets", {
    body: { scope: "control-vnc" },
    expected: 201,
  });
  const listed = async () =>
    (await call("GET", "/computers")).find((x: { id: string }) => x.id === id);
  await sleep(85);
  assert((await listed()).status?.ready === true, "Active grant did not protect VM");
  await call("DELETE", path + "/console-tickets/" + ticket.id);
  await wait(
    async () => (await listed()).status?.printableStatus === "Stopped",
    210,
    "Idle policy did not stop",
  );
  await wait(
    async () => (await call("GET", path)).instance === null,
    120,
    "Idle stop VMI deletion did not converge",
  );
  assert(
    (await call("GET", "/audit")).some(
      (e: { actor: string; group: string; computerId: string }) =>
        e.actor === "system" && e.group === "stop" && e.computerId === id,
    ),
  );
  assert(
    (await call("GET", "/audit", { token: B })).every(
      (e: { computerId: string }) => e.computerId !== id,
    ),
  );
  writeJson(OUT + "/verification.json", {
    activeGrantProtected: true,
    idleStopped: true,
    vmRetained: true,
    accountAuditIsolated: true,
  });
} finally {
  await call("DELETE", path, { expected: 202 });
}
