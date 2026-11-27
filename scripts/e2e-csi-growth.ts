/** API-only CSI capacity measurements in an actual VirtioFS guest. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { proofTools } from "./proof-tools.ts";
import { key, sha, sleep, wait, writeJson } from "./api-client.ts";
const { call, binary, B, file } = proofTools("evidence/csi-growth"),
  GIB = 1024 ** 3;
const cloud = String.raw`#!/bin/bash
set -eu
mkdir -p /mnt/exchange
cat >/usr/local/bin/measure-exchange <<'SH'
#!/bin/bash
set -eu
cd /mnt/exchange
index=before
test ! -f out-before.bin || index=after
read -r blocks unit < <(stat -f -c '%b %S' .)
printf '%s\n%s\n' "$((blocks*unit))" "$(sha256sum in-challenge.bin | cut -d ' ' -f1)" > .measure.tmp
sha256sum .measure.tmp | cut -d ' ' -f1 > .measure.sha256.tmp
mv .measure.tmp "out-$index.bin"
mv .measure.sha256.tmp "out-$index.bin.sha256"
sync
SH
chmod 755 /usr/local/bin/measure-exchange
cat >/etc/systemd/system/measure-exchange.service <<'UNIT'
[Unit]
Description=Measure actual guest exchange filesystem
[Service]
Type=oneshot
ExecStartPre=/usr/bin/mount -t virtiofs exchange /mnt/exchange
ExecStartPre=/usr/bin/findmnt -n -t virtiofs /mnt/exchange
ExecStart=/usr/local/bin/measure-exchange
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now measure-exchange.service
`;
const quota = async () => (await call("GET", "/account/quota")).usage.storageGiB,
  baseline = await quota();
const spec = {
  version: 1,
  name: "csi-growth",
  architecture: "amd64",
  cpu: 1,
  memoryMiB: 1536,
  image: "fedora-exchange-test",
  storage: { systemGiB: 6, exchangeGiB: 1, exchangeMode: "virtiofs" },
  cloudInit: cloud,
};
const created = await call("POST", "/computers", { body: spec, expected: 202, phase: "create" }),
  path = "/computers/" + created.result.id,
  state = () => call("GET", path);
type Volume = {
  kind: string;
  pvcPhase: string;
  pvcUid: string;
  growth: {
    reservedGiB: number;
    submitted: boolean;
    pvcCapacityConverged: boolean;
    guestDiskGrowthVerified: boolean;
    guestFilesystemGrowthVerified: boolean;
  };
};
const volumes = async () =>
  Object.fromEntries(
    ((await call("GET", path + "/storage")).volumes as Volume[]).map((v) => [v.kind, v]),
  );
const stopped = async () => {
  const s = await state(),
    v = s.status ?? {};
  return !s.instance &&
    s.desired.runStrategy === "Halted" &&
    !v.created &&
    !v.ready &&
    !v.stateChangeRequests?.length
    ? s
    : null;
};
const running = async () => {
  const i = (await state()).instance;
  return i?.status.phase === "Running" ? i.metadata.uid : null;
};
async function download(name: string) {
  await wait(
    async () => (await call("GET", path + "/files")).some((f: { name: string }) => f.name === name),
    600,
    "Guest measurement not published",
  );
  const [data, headers] = await binary("GET", path + "/files/" + name, {
    phase: "guest measurement",
  });
  assert.equal(headers.get("X-Content-SHA256"), sha(data));
  await call("GET", path + "/files/" + name, { token: B, expected: 404 });
  writeFileSync(file(name), data);
  const [size, digest] = data.toString().trim().split(/\r?\n/);
  assert(/^[0-9]+$/.test(size) && /^[a-f0-9]{64}$/.test(digest));
  return [Number(size), digest] as const;
}
async function grow(disk: string, sizeGiB: number) {
  const initial = (await state()).desired,
    end = performance.now() + 60000,
    conflicts = ["VM identity or resource version changed", "Kubernetes rejected request (409)"];
  while (performance.now() < end) {
    let current = await stopped();
    assert(current);
    assert.deepEqual(current.desired, initial);
    const body = { disk, sizeGiB, expectedResourceVersion: current.resourceVersion };
    let response = await call("POST", path + "/storage/plan", { body, expected: [200, 409] });
    if (response.error) {
      assert(conflicts.includes(response.error));
      await sleep(2);
      continue;
    }
    current = await stopped();
    assert(current);
    assert.deepEqual(current.desired, initial);
    body.expectedResourceVersion = current.resourceVersion;
    const idem = key();
    response = await call("PATCH", path + "/storage", {
      body,
      idem,
      expected: [202, 409],
      phase: "growth submit",
    });
    if (response.error) {
      assert(conflicts.includes(response.error));
      assert.deepEqual(
        await call("PATCH", path + "/storage", { body, idem, expected: 409 }),
        response,
      );
      await sleep(2);
      continue;
    }
    assert.equal(response.status, "submitted");
    assert.deepEqual(
      await call("PATCH", path + "/storage", { body, idem, expected: 202 }),
      response,
    );
    return response;
  }
  throw Error("Growth version conflict did not stabilize");
}
const start = () => call("POST", path + "/start", { body: {}, expected: 202 });
const stop = async () => {
  await call("POST", path + "/stop", { body: {}, expected: 202 });
  await wait(stopped, 240, "Stop did not converge");
};
try {
  await wait(
    async () => (await volumes()).exchange.pvcPhase === "Bound",
    300,
    "CSI exchange claim not bound",
  );
  const payload = randomBytes(4096),
    digest = sha(payload),
    upload = await call("PUT", path + "/files/challenge.bin", {
      raw: payload,
      expected: 202,
      headers: { "Content-Type": "application/octet-stream", "X-Content-SHA256": digest },
      phase: "upload",
    });
  assert.equal(upload.result.sha256, digest);
  await start();
  const uid = await wait(running, 600, "Guest did not boot"),
    before = await download("before.bin");
  assert(before[1] === digest && before[0] > 0 && before[0] <= GIB);
  const original = await volumes();
  assert(Object.values(original).every((v) => v.pvcUid && v.pvcPhase === "Bound"));
  await stop();
  const body = {
    disk: "exchange.disk",
    sizeGiB: 2,
    expectedResourceVersion: (await state()).resourceVersion,
  };
  await call("PATCH", path + "/storage", { token: B, body, expected: 404 });
  await call("PATCH", path + "/storage", {
    body: { ...body, expectedResourceVersion: "stale" },
    expected: 409,
  });
  assert.equal(await quota(), baseline + 7);
  const exchange = await grow("exchange.disk", 2);
  assert.equal(await quota(), baseline + 8);
  const reserved = (await volumes()).exchange.growth;
  assert(reserved.reservedGiB === 2 && reserved.submitted);
  const boot = await grow("system.disk", 8);
  assert.equal(await quota(), baseline + 10);
  await call("PATCH", path + "/storage", {
    body: {
      disk: "exchange.disk",
      sizeGiB: 1,
      expectedResourceVersion: (await state()).resourceVersion,
    },
    expected: 422,
  });
  await start();
  const newUid = await wait(running, 600, "Guest did not restart after PVC growth"),
    after = await download("after.bin");
  assert(
    newUid !== uid &&
      after[1] === digest &&
      before[0] < after[0] &&
      after[0] <= 2 * GIB &&
      after[0] >= before[0] + GIB * 0.75,
  );
  assert.deepEqual(await download("before.bin"), before);
  const final = await wait(
    async () => {
      const current = await volumes();
      return Object.values(current).every((v) => v.growth?.pvcCapacityConverged) ? current : null;
    },
    300,
    "Native CSI growth did not converge",
  );
  const identities = (v: Record<string, Volume>) =>
    Object.fromEntries(Object.entries(v).map(([k, v]) => [k, v.pvcUid]));
  assert.deepEqual(identities(original), identities(final));
  for (const v of Object.values(final))
    assert(!v.growth.guestDiskGrowthVerified && !v.growth.guestFilesystemGrowthVerified);
  for (const op of [exchange, boot])
    await wait(
      async () =>
        (await call("GET", "/operations/" + op.operationId)).observation?.state === "converged",
      120,
      "Growth operation not reconciled",
    );
  await stop();
  const [bundle, headers] = await binary("GET", path + "/exchange-bundle");
  assert.equal(headers.get("X-Content-SHA256"), sha(bundle));
  writeFileSync(file("exchange-bundle.tar"), bundle);
  writeJson(file("verification.json"), {
    runId: process.env.GITHUB_RUN_ID,
    commit: process.env.GITHUB_SHA,
    original,
    expanded: final,
    guestBeforeBytes: before[0],
    guestAfterBytes: after[0],
    inputSha256: digest,
    actualVirtioFsGrowthVerified: true,
    virtualBootDiskGrowthVerified: false,
    guestBootFilesystemGrowthVerified: false,
    samePvcIdentities: true,
    crossAccountDenied: true,
    quotaReserved: true,
  });
} finally {
  const deletion = await call("DELETE", path + "?deleteDisks=true", { expected: 202 });
  await wait(
    async () =>
      (await call("GET", "/operations/" + deletion.operationId)).observation?.state === "converged",
    240,
    "Delete did not converge",
  );
  assert.equal(await quota(), baseline);
}
console.log("Real CSI PVC expansion and actual guest VirtioFS capacity increase verified");
