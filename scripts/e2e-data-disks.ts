/** Real API-only cold data disk lifecycle, retention, ownership and native export. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import {
  client,
  key,
  sha,
  sleep,
  wait as poll,
  writeJson,
  ResponseMismatch,
  type CallOptions,
} from "./api-client.ts";
const api = client({ timeout: 45 }),
  { A, B } = api;
async function call(method: string, path: string, o: CallOptions = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await api.call(method, path, o);
    } catch (e) {
      if (
        method !== "GET" ||
        attempt === 7 ||
        (e instanceof ResponseMismatch && ![502, 503, 504].includes(e.status))
      )
        throw e;
      if (!(e instanceof ResponseMismatch || e instanceof TypeError || e instanceof DOMException))
        throw e;
      await sleep(2);
    }
  }
  throw Error("Read transport did not recover");
}
const wait = <T>(fn: () => Promise<T>, seconds = 420) =>
  poll(fn, seconds, "Data disk convergence timed out", 3);
const spec = {
  version: 1,
  name: "ci-data-disk",
  architecture: "amd64",
  cpu: 1,
  memoryMiB: 512,
  image: "cirros-smoke",
  storage: { systemGiB: 2, exchangeGiB: 1 },
};
const quota = async () => (await call("GET", "/account/quota")).usage.storageGiB,
  baseline = await quota();
const vm: string = (await call("POST", "/computers", { body: spec, idem: key(), expected: 202 }))
    .result.id,
  path = "/computers/" + vm;
const state = () => call("GET", path);
type Disk = {
  kind: string;
  diskName: string;
  attached: boolean;
  dataVolumePhase: string;
  pvcPhase: string;
  pvcUid: string;
  dataVolumeUid: string;
  source?: string;
  sizeGiB: number;
};
const disk = async (name = "work") =>
  ((await call("GET", path + "/storage")).volumes as Disk[]).find(
    (x) => x.kind === "data" && x.diskName === name,
  );
const req = async (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  name: "work",
  expectedResourceVersion: (await state()).resourceVersion,
  ...extra,
});
const versionConflict = (e: unknown) =>
  e instanceof ResponseMismatch &&
  e.status === 409 &&
  [
    "VM identity or resource version changed",
    "VM resource version changed before disk reservation",
  ].includes(String(e.result.error));
async function submitDisk(input: Record<string, unknown>) {
  const initial = (await state()).desired,
    deadline = performance.now() + 45000;
  while (performance.now() < deadline) {
    let current = await state();
    assert.deepEqual(current.desired, initial);
    const body = { ...input, expectedResourceVersion: current.resourceVersion };
    try {
      await call("POST", path + "/disks/plan", { body });
    } catch (e) {
      if (!versionConflict(e)) throw e;
      await sleep(1);
      continue;
    }
    current = await state();
    assert.deepEqual(current.desired, initial);
    body.expectedResourceVersion = current.resourceVersion;
    const idem = key();
    let result;
    try {
      result = await call("POST", path + "/disks", { body, idem, expected: 202 });
    } catch (e) {
      if (!versionConflict(e)) throw e;
      await call("POST", path + "/disks", { body, idem, expected: 409 });
      await sleep(1);
      continue;
    }
    assert.equal(result.status, "submitted");
    assert.deepEqual(await call("POST", path + "/disks", { body, idem, expected: 202 }), result);
    return result;
  }
  throw Error("Disk resource version did not stabilize");
}
const change = async (action: string, extra: Record<string, unknown> = {}) =>
  submitDisk(await req(action, extra));
const stopped = async () => {
  const s = await state(),
    status = s.status ?? {};
  return !s.instance && !status.stateChangeRequests?.length && !status.created && !status.ready
    ? s
    : null;
};
async function running(attached: boolean) {
  const s = await state(),
    i = s.instance ?? {};
  if (i.status?.phase !== "Running") return null;
  const v = (i.spec?.volumes ?? []).filter((x: { name: string }) => x.name === "data-work");
  if (attached ? v.length !== 1 || v[0].dataVolume?.name !== vm + "-data-work" : v.length !== 0)
    return null;
  const d = await disk();
  return d && d.attached === attached && d.dataVolumePhase === "Succeeded" && d.pvcUid ? d : null;
}
let exportPath: string | undefined,
  copy: Disk | undefined,
  imported: unknown,
  failed = false;
const deleteKeys = new Map<string, string>(),
  trace = "evidence/data-disks-cleanup.jsonl";
mkdirSync("evidence", { recursive: true });
writeFileSync(trace, "");
const note = (entry: Record<string, unknown>) =>
  appendFileSync(trace, JSON.stringify(entry) + "\n");
async function gone(ep: string) {
  try {
    await call("GET", ep);
    return false;
  } catch (e) {
    if (e instanceof ResponseMismatch && e.status === 404) return true;
    throw e;
  }
}
async function receipt(idem: string) {
  try {
    return await call("GET", "/operations/by-key", { idem });
  } catch (e) {
    if (e instanceof ResponseMismatch && e.status === 404) return null;
    throw e;
  }
}
const submitted = (r: { id: string; status: string; result: unknown }) => ({
  operationId: r.id,
  status: r.status,
  result: r.result,
});
async function deleteKnown(ep: string, missing: () => Promise<boolean>) {
  let idem = deleteKeys.get(ep);
  if (!idem) {
    idem = key();
    deleteKeys.set(ep, idem);
  }
  let prior = await receipt(idem);
  if (prior) {
    assert.equal(prior.status, "submitted", "Earlier DELETE is not confirmed; inspect receipt");
    return submitted(prior);
  }
  try {
    const result = await call("DELETE", ep, { idem, expected: 202 });
    note({ path: ep, source: "http", status: result.status, operationId: result.operationId });
    assert.equal(result.status, "submitted");
    return result;
  } catch (e) {
    if (!(e instanceof TypeError || e instanceof DOMException)) throw e;
    note({ path: ep, source: "transport", error: e.name });
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      prior = await receipt(idem);
      if (prior?.status === "submitted") {
        note({ path: ep, source: "durable-receipt", status: prior.status, operationId: prior.id });
        return submitted(prior);
      }
      assert(!["rejected", "unknown"].includes(prior?.status), "DELETE outcome not confirmed");
      await sleep(2);
    }
    if (!prior && !(await missing())) {
      note({ path: ep, source: "observed-existing-target-no-receipt" });
      const result = await call("DELETE", ep, { idem, expected: 202 });
      note({
        path: ep,
        source: "same-key-http",
        status: result.status,
        operationId: result.operationId,
      });
      assert.equal(result.status, "submitted");
      return result;
    }
    throw Error("Unconfirmed DELETE after read-only reconciliation", { cause: e });
  }
}
async function exportBytes(ep: string, claim: string, capacity: number, prefix?: Buffer) {
  const res = await fetch((process.env.API_URL ?? "http://127.0.0.1:3000/api/v1") + ep + "/file", {
    headers: { authorization: "Bearer " + A, connection: "close" },
    redirect: "error",
    signal: AbortSignal.timeout(180000),
  });
  assert.equal(res.status, 200);
  const value = res.headers.get("X-VM-Export-Bytes");
  assert(value && /^[1-9][0-9]*$/.test(value));
  const length = Number(value);
  assert(Number.isSafeInteger(length) && length <= capacity * 1024 ** 3);
  const framing = res.headers.get("Content-Length");
  assert(framing === null || framing === value);
  assert.equal(res.headers.get("Content-Type")?.split(";")[0], "application/octet-stream");
  assert.equal(res.headers.get("Content-Disposition"), 'attachment; filename="' + claim + '.raw"');
  assert(res.body);
  const reader = res.body.getReader(),
    h = createHash("sha256");
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      assert(total + value.length <= length);
      if (prefix && total < prefix.length) {
        const n = Math.min(prefix.length - total, value.length);
        assert(Buffer.from(value.subarray(0, n)).equals(prefix.subarray(total, total + n)));
      }
      h.update(value);
      total += value.length;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  assert.equal(total, length);
  assert(!prefix || total >= prefix.length);
  return { bytes: total, sha256: h.digest("hex") };
}
const start = () => call("POST", path + "/start", { body: {}, idem: key(), expected: 202 });
const stop = async () => {
  await call("POST", path + "/stop", { body: {}, idem: key(), expected: 202 });
  await wait(stopped);
};
const finishExport = async (ep: string) => {
  await deleteKnown(ep, () => gone(ep));
  await wait(() => gone(ep));
  exportPath = undefined;
};
try {
  await wait(stopped);
  const growth = {
    disk: "system.disk",
    sizeGiB: 3,
    expectedResourceVersion: (await state()).resourceVersion,
  };
  await call("PATCH", path + "/storage", { body: growth, token: B, idem: key(), expected: 404 });
  await call("POST", path + "/storage/plan", { body: growth, expected: 422 });
  await call("PATCH", path + "/storage", { body: growth, idem: key(), expected: 422 });
  assert.equal(await quota(), baseline + 3);
  await call("POST", path + "/disks", {
    body: await req("create", { sizeGiB: 1 }),
    token: B,
    idem: key(),
    expected: 404,
  });
  await change("create", { sizeGiB: 1 });
  const created = await wait(async () => {
    const d = await disk();
    return d?.dataVolumeUid && !d.attached ? d : null;
  });
  assert.equal(await quota(), baseline + 4);
  await change("attach");
  await start();
  const initial = await wait(() => running(true));
  assert.equal(initial.dataVolumeUid, created.dataVolumeUid);
  await call("POST", path + "/disks", { body: await req("detach"), idem: key(), expected: 409 });
  await stop();
  await change("detach");
  const detached = await disk();
  assert(detached && !detached.attached && detached.pvcUid === initial.pvcUid);
  assert.equal(await quota(), baseline + 4);
  await start();
  await wait(() => running(false));
  await stop();
  await change("attach");
  await start();
  const final = await wait(() => running(true));
  assert(final.pvcUid === initial.pvcUid && final.dataVolumeUid === initial.dataVolumeUid);
  await stop();
  const cloned = await submitDisk({
    action: "clone",
    name: "copy",
    source: "work",
    sizeGiB: 2,
    expectedResourceVersion: (await state()).resourceVersion,
  });
  copy = await wait(async () => {
    const d = await disk("copy");
    return d?.dataVolumePhase === "Succeeded" && d.pvcPhase === "Bound" && d.pvcUid ? d : null;
  });
  assert(
    copy.pvcUid !== final.pvcUid && copy.source === "work" && !copy.attached && copy.sizeGiB === 2,
  );
  const retained = await disk();
  assert(retained?.pvcUid === final.pvcUid && retained.sizeGiB === 1);
  await wait(
    async () =>
      (await call("GET", "/operations/" + cloned.operationId)).observation?.state === "converged",
  );
  assert.equal(await quota(), baseline + 6);
  const payload = Buffer.alloc(1024 * 1024);
  payload.write("VM interface imported disk fixture");
  const digest = sha(payload);
  await submitDisk({
    action: "import",
    name: "imported",
    sizeGiB: 1,
    expectedResourceVersion: (await state()).resourceVersion,
    media: {
      format: "raw",
      bytes: payload.length,
      sha256: digest,
      source: "ci fixture",
      os: "test",
      version: "1",
      authorizedByClient: true,
    },
  });
  const endpoint = path + "/media/data-imported";
  await call("GET", endpoint, { token: B, expected: 404 });
  await wait(async () => (await call("GET", endpoint)).phase === "UploadReady");
  await call("POST", path + "/disks/plan", {
    body: {
      action: "attach",
      name: "imported",
      expectedResourceVersion: (await state()).resourceVersion,
    },
    expected: 409,
  });
  for (const [raw, expected] of [
    [Buffer.alloc(payload.length, 33), 422],
    [payload, 202],
  ] as const)
    await call("PUT", endpoint, {
      raw,
      headers: { "content-type": "application/octet-stream" },
      idem: key(),
      expected,
      timeout: 180,
    });
  const ready = await wait(async () => {
    const s = await call("GET", endpoint);
    return s.ready ? s : null;
  });
  imported = ready;
  assert.equal(ready.metadata.sha256, digest);
  let ep =
    path +
    "/disk-exports/" +
    (await call("POST", path + "/disk-exports/imported", { idem: key(), expected: 202 })).result
      .exportId;
  exportPath = ep;
  await call("GET", ep, { token: B, expected: 404 });
  await call("POST", path + "/start", { body: {}, idem: key(), expected: 409 });
  await wait(async () => (await call("GET", ep)).ready);
  const exported = {
    ...(await exportBytes(ep, vm + "-data-imported", 1, payload)),
    inputPrefixVerified: true,
  };
  await finishExport(ep);
  assert.equal(await quota(), baseline + 7);
  const systemExports: Record<string, unknown> = {};
  for (const [selector, suffix, capacity] of [
    ["system.disk", "-boot", 2],
    ["exchange.disk", "-exchange", 1],
  ] as const) {
    const e = (
      await call("POST", path + "/disk-exports/" + selector, { idem: key(), expected: 202 })
    ).result;
    assert.equal(e.disk, selector);
    ep = path + "/disk-exports/" + e.exportId;
    exportPath = ep;
    await call("GET", ep, { token: B, expected: 404 });
    await wait(async () => (await call("GET", ep)).ready);
    systemExports[selector] = await exportBytes(ep, vm + suffix, capacity);
    await finishExport(ep);
  }
  await call("DELETE", path, { idem: key(), expected: 409 });
  writeJson("evidence/data-disks.json", {
    initial,
    detached,
    reattached: final,
    clone: copy,
    import: imported,
    export: exported,
    systemExports,
    guestByteProof: false,
  });
} catch (e) {
  failed = true;
  throw e;
} finally {
  try {
    if (exportPath && !(await gone(exportPath))) await finishExport(exportPath);
    const reservations = ((await call("GET", path + "/storage")).volumes as Disk[])
      .filter((v) => v.kind === "data")
      .map((v) => vm + "-data-" + v.diskName);
    const deletion = await deleteKnown(path + "?deleteDisks=true", () => gone(path)),
      affected = deletion.result.affectedDisks as string[];
    assert(reservations.every((v) => affected.includes(v)));
    if (copy) assert(affected.includes(vm + "-data-copy"));
    if (imported) assert(affected.includes(vm + "-data-imported"));
    await wait(
      async () =>
        (await call("GET", "/operations/" + deletion.operationId)).observation?.state ===
        "converged",
    );
    assert.equal(await quota(), baseline);
    note({ path, source: "cleanup-converged", quotaGiB: baseline });
  } catch (e) {
    note({ path, source: "cleanup-failed", error: e instanceof Error ? e.name : "unknown" });
    if (!failed) throw e;
    console.log("Cleanup failed; retaining original error and cleanup trace");
  }
}
console.log(
  "Real cold data disk lifecycle and stable PVC identities passed; guest data verification remains separate.",
);
