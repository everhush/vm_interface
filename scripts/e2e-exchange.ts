/** Actual product API upload -> real native guest -> download, never kubectl. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { client, key, sha, wait, writeJson } from "./api-client.ts";
import { tarMembers } from "./verify_csi_evidence.ts";
const { call, binary, B } = client({ timeout: 45 });
const cloud =
  "#!/bin/bash\nset -eu\nmkdir -p /mnt/exchange\nmodprobe virtiofs || true\nmount -t virtiofs exchange /mnt/exchange\ntest \"$(findmnt -n -o FSTYPE /mnt/exchange)\" = virtiofs\ncd /mnt/exchange\ntest -f in-challenge.bin\numask 002\n(cat in-challenge.bin; printf '\\nactual-fedora-guest\\n') > .result.tmp\nmv .result.tmp out-result.bin\nsha256sum out-result.bin | cut -d ' ' -f 1 > .digest.tmp\nmv .digest.tmp out-result.bin.sha256\nsync\n";
const spec = {
  version: 1,
  name: "ci-exchange",
  architecture: "amd64",
  cpu: 1,
  memoryMiB: 1536,
  image: "fedora-exchange-test",
  storage: { systemGiB: 8, exchangeGiB: 1, exchangeMode: "virtiofs" },
  cloudInit: cloud,
};
const plan = await call("POST", "/computers/plan", { body: spec });
assert.equal(plan.manifest.spec.template.spec.domain.devices.filesystems[0].name, "exchange");
const created = await call("POST", "/computers", { body: spec, idem: key(), expected: 202 }),
  vm = created.result.id,
  path = "/computers/" + vm;
try {
  const payload = randomBytes(4096),
    digest = sha(payload),
    upload = path + "/files/challenge.bin";
  const headers = (hash: string) => ({
    "Content-Type": "application/octet-stream",
    "X-Content-SHA256": hash,
  });
  await call("PUT", upload, {
    token: B,
    raw: payload,
    headers: headers(digest),
    idem: key(),
    expected: 404,
  });
  await call("PUT", upload, {
    raw: payload,
    headers: headers("0".repeat(64)),
    idem: key(),
    expected: 422,
  });
  const k = key(),
    first = await call("PUT", upload, {
      raw: payload,
      headers: headers(digest),
      idem: k,
      expected: 202,
    });
  assert.equal(first.result.sha256, digest);
  assert.equal(first.result.size, payload.length);
  assert.deepEqual(
    await call("PUT", upload, { raw: payload, headers: headers(digest), idem: k, expected: 202 }),
    first,
  );
  const conflict = Buffer.from("conflict");
  await call("PUT", upload, {
    raw: conflict,
    headers: headers(sha(conflict)),
    idem: key(),
    expected: 409,
  });
  assert.deepEqual(await call("GET", path + "/files"), []);
  await call("GET", path + "/files", { token: B, expected: 404 });
  await call("GET", path + "/exchange-bundle", { token: B, expected: 404 });
  await call("POST", path + "/start", { body: {}, idem: key(), expected: 202 });
  await wait(
    async () =>
      (await call("GET", path + "/files")).some((f: { name: string }) => f.name === "result.bin"),
    600,
    "No guest-published output",
    3,
  );
  const expected = Buffer.concat([payload, Buffer.from("\nactual-fedora-guest\n")]);
  await call("GET", path + "/exchange-bundle", { expected: 409 });
  const [result, resHeaders] = await binary("GET", path + "/files/result.bin");
  assert(result.equals(expected));
  assert.equal(resHeaders.get("X-Content-SHA256"), sha(expected));
  await call("GET", path + "/files/result.bin", { token: B, expected: 404 });
  type Volume = { kind: string; pvcUid: string };
  const before = await call("GET", path + "/storage");
  assert.equal(before.volumes.length, 2);
  const identities = Object.fromEntries(
    (before.volumes as Volume[]).map((x) => [x.kind, x.pvcUid]),
  );
  assert(Object.values(identities).every(Boolean));
  await call("POST", path + "/stop", { body: {}, idem: key(), expected: 202 });
  await wait(
    async () => {
      const s = await call("GET", path),
        status = s.status ?? {};
      return (
        s.instance === null &&
        !status.created &&
        !status.ready &&
        !status.stateChangeRequests?.length
      );
    },
    240,
    "Stop did not converge",
    3,
  );
  const stopped = await call("GET", path + "/storage");
  assert.deepEqual(
    Object.fromEntries((stopped.volumes as Volume[]).map((x) => [x.kind, x.pvcUid])),
    identities,
  );
  const [after] = await binary("GET", path + "/files/result.bin");
  assert(after.equals(expected));
  const [bundle, bundleHeaders] = await binary("GET", path + "/exchange-bundle");
  assert.equal(bundleHeaders.get("X-Content-SHA256"), sha(bundle));
  const members = tarMembers(bundle);
  assert.deepEqual([...members.keys()].sort(), [
    "download/result.bin",
    "manifest.json",
    "upload/challenge.bin",
  ]);
  assert(members.get("upload/challenge.bin")!.equals(payload));
  assert(members.get("download/result.bin")!.equals(expected));
  const manifest = JSON.parse(members.get("manifest.json")!.toString("utf8"));
  assert.equal(manifest.scope, "published-exchange-files-only");
  assert.deepEqual(
    Object.fromEntries(
      (manifest.files as { name: string; sha256: string }[]).map((x) => [x.name, x.sha256]),
    ),
    { "upload/challenge.bin": digest, "download/result.bin": sha(expected) },
  );
  writeFileSync("evidence/exchange-bundle.tar", bundle);
  writeJson("evidence/exchange-verification.json", {
    scope: "real-product-api",
    inputBytes: payload.length,
    inputSha256: digest,
    outputBytes: result.length,
    outputSha256: sha(result),
    nativeGuest: "Fedora",
    guestTransform: true,
    crossAccountDenied: true,
    idempotent: true,
    stoppedDataPersistent: true,
    publishedBundleSha256: sha(bundle),
    pvcIdentities: identities,
  });
  console.log(
    "Actual guest-visible VirtioFS file bytes and stopped persistence verified through API",
  );
} finally {
  await call("DELETE", path, { idem: key(), expected: 409 });
  await call("DELETE", path + "?deleteDisks=true", { idem: key(), expected: 202 });
}
