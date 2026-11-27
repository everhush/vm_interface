/** Real native guest login screen, original recording and API isolation. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { proofTools, batch, count } from "./proof-tools.ts";
import { key, sha, sleep, wait, writeJson, type CallOptions } from "./api-client.ts";
import { cirrosReady } from "./cirros-screen.ts";
const h = proofTools(process.env.PROOF_OUTPUT_DIR ?? "evidence/api-control-proof"),
  { call, binary, B, file, screen } = h;
let path: string | undefined,
  record: string | undefined,
  keyId: string | undefined,
  ticket: string | undefined,
  lease = false,
  stopped = false;
const first = "scriptstart",
  second = "scriptdone";
const control = (body?: unknown, expected = 200, phase?: string, idem?: string): CallOptions => ({
  token: ticket,
  scheme: "Console",
  body,
  expected,
  phase,
  idem,
});
try {
  const vm = await call("POST", "/computers", {
    body: {
      version: 1,
      name: "api-control-proof",
      architecture: "amd64",
      cpu: 1,
      memoryMiB: 512,
      image: "cirros-smoke",
    },
    expected: 202,
    phase: "create",
  });
  path = "/computers/" + vm.result.id;
  const p = path!;
  await call("GET", p, { token: B, expected: 404, phase: "cross-account denial" });
  await call("POST", p + "/start", { body: {}, expected: 202, phase: "start" });
  const uid = await wait(
    async () => {
      const i = (await call("GET", p)).instance;
      return i?.status.phase === "Running" ? i.metadata.uid : null;
    },
    360,
    "VMI not Running",
  );
  const runningAt = performance.now();
  await wait(
    async () => {
      const [norm, text] = await screen(p, "before.png", true);
      return (
        cirrosReady(text, performance.now() - runningAt) &&
        !norm.includes(first) &&
        !norm.includes(second)
      );
    },
    240,
    "No real CirrOS login prompt after settling",
  );
  const k = await call("POST", "/keys", {
    body: { label: "api-control-proof", permission: "manage", ttlSeconds: 600 },
    expected: 201,
    phase: "controller key",
  });
  keyId = k.id;
  const grant = await call("POST", p + "/console-tickets", {
    token: k.token,
    body: { scope: "control-vnc" },
    expected: 201,
    phase: "control ticket",
  });
  assert(grant.actor === "automation" && grant.instanceUid === uid);
  ticket = grant.token;
  const collection = p + "/recordings";
  await call("POST", collection, {
    body: { consent: false, maxSeconds: 90 },
    expected: 422,
    phase: "consent denial",
  });
  const idem = key(),
    started = await call("POST", collection, {
      body: { consent: true, maxSeconds: 90 },
      expected: 202,
      idem,
      phase: "record start",
    });
  record = collection + "/" + started.result.id;
  const rec = record!;
  assert.equal(started.result.instanceUid, uid);
  assert.equal(
    (
      await call("POST", collection, {
        body: { consent: true, maxSeconds: 90 },
        expected: 202,
        idem,
      })
    ).result.id,
    started.result.id,
  );
  await call("GET", rec, { token: B, expected: 404, phase: "record ownership denial" });
  await wait(
    async () => {
      const s = await call("GET", rec);
      assert(!["failed", "completed"].includes(s.status));
      return s.status === "recording";
    },
    20,
    "Recording did not start",
  );
  await sleep(4);
  await call("POST", p + "/input", control(batch(first), 409, "unleased input denial"));
  assert(
    !(await screen(p, "denied-input.png", true))[0].includes(first),
    "Unleased input reached guest",
  );
  const claim = await call("POST", p + "/input-lease", control({}, 200, "lease acquire"));
  lease = true;
  assert(claim.active && claim.actor === "automation");
  const one = await call("POST", p + "/input", control(batch(first), 202, "first input"));
  assert.equal(one.result.accepted, first.length * 2);
  await wait(
    async () => count((await screen(p, "after-first.png", true))[0], first) === 1,
    18,
    "First input not visible exactly once",
  );
  await sleep(5);
  await call("POST", p + "/input-lease", control({}));
  const k2 = key(),
    two = await call("POST", p + "/input", control(batch(second), 202, "second input", k2));
  assert.equal(two.result.accepted, second.length * 2);
  assert.deepEqual(
    await call("POST", p + "/input", control(batch(second), 202, "idempotent replay", k2)),
    two,
  );
  await wait(
    async () => count((await screen(p, "after-second.png", true))[0], second) === 1,
    18,
    "Second input not visible or duplicated",
  );
  await sleep(6);
  await call("DELETE", p + "/input-lease", control(undefined, 200, "lease release"));
  lease = false;
  await call("POST", rec + "/stop", { body: {}, expected: 202, phase: "record stop" });
  const meta = await wait(
    async () => {
      const s = await call("GET", rec);
      assert.notEqual(s.status, "failed");
      return s.status === "completed" ? s : null;
    },
    100,
    "Recording did not complete",
  );
  assert.equal(meta.instanceUid, uid);
  const [data, headers] = await binary("GET", rec + "/file", { phase: "retrieve MP4" });
  assert(
    headers.get("content-type") === "video/mp4" &&
      data.length > 0 &&
      data.length <= 64 * 1024 ** 2 &&
      data.length === meta.bytes &&
      sha(data) === meta.sha256,
  );
  const raw = file("platform-recording.mp4");
  writeFileSync(raw, data);
  const video = h.checkVideo(raw, first, second);
  await binary("GET", rec + "/file", { token: B, expected: 404, phase: "video ownership denial" });
  await call("DELETE", rec, { expected: 202, phase: "delete recording" });
  await call("GET", rec, { expected: 404 });
  record = undefined;
  await call("DELETE", "/keys/" + keyId, { phase: "revoke controller key" });
  keyId = undefined;
  await call("POST", p + "/input-lease", control({}, 401, "revoked key denial"));
  await call("POST", p + "/stop", { body: {}, expected: 202, phase: "stop" });
  await wait(async () => !(await call("GET", p)).instance, 240, "Stop not converged");
  stopped = true;
  await call("DELETE", p, { expected: 202, phase: "delete" });
  await wait(
    async () =>
      !(await call("GET", "/computers")).some((v: { id: string }) => v.id === vm.result.id),
    120,
    "Delete not converged",
  );
  path = undefined;
  const derived = h.presentation(raw);
  writeJson(file("verification.json"), {
    scope: "real native x86 guest login-screen control via HTTP API",
    runId: process.env.GITHUB_RUN_ID,
    commit: process.env.GITHUB_SHA,
    vmId: vm.result.id,
    instanceUid: uid,
    actualGuestBootScreen: true,
    guestLoginOrApplicationExecutionVerified: false,
    automationLease: true,
    unleasedInputDenied: true,
    idempotentReplay: true,
    crossAccountDenied: true,
    keyRevoked: true,
    stoppedAndDeleted: stopped,
    recording: {
      file: "platform-recording.mp4",
      bytes: data.length,
      sha256: meta.sha256,
      ...video,
    },
    derivedPresentation: derived,
    screenshots: Object.fromEntries(
      ["before.png", "after-first.png", "after-second.png"].map((p) => [
        p,
        sha(readFileSync(file(p))),
      ]),
    ),
    trace: {
      file: "http-trace.jsonl",
      sha256: sha(readFileSync(h.trace!)),
      calls: h.events.length,
    },
  });
  console.log("Verified real script-driven guest input, raw API MP4 and annotated evidence");
} finally {
  const cleanup: [string, string | undefined, CallOptions][] = [
    ["DELETE", path && lease ? path + "/input-lease" : undefined, control()],
    ["POST", record ? record + "/stop" : undefined, { body: {}, expected: 202 }],
    ["DELETE", keyId ? "/keys/" + keyId : undefined, {}],
    ["DELETE", path, { expected: 202 }],
  ];
  for (const [method, endpoint, opts] of cleanup)
    if (endpoint)
      try {
        await call(method, endpoint, opts);
      } catch {
        console.error("Cleanup incomplete:", method, endpoint);
      }
}
