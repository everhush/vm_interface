/** Real API-only authorized media import and native guest display. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import {
  client,
  key,
  sha,
  sleep,
  wait,
  writeJson,
  ResponseMismatch,
  type CallOptions,
} from "./api-client.ts";
import { binaryRequest } from "./media-http.ts";
import { ocr } from "./evidence-frames.ts";
const api = client({ timeout: 240 }),
  { A, B } = api,
  base = process.env.API_URL ?? "http://127.0.0.1:3000/api/v1";
const mode = process.argv[3] ?? "direct";
assert(["direct", "resumable", "dual", "url"].includes(mode));
mkdirSync("evidence", { recursive: true });
const trace = "evidence/media-" + mode + "-http.jsonl";
writeFileSync(trace, "");
async function request(method: string, path: string, o: CallOptions = {}) {
  const token = o.token ?? A,
    expected = o.expected ?? 200;
  assert(typeof expected === "number");
  let status: number | null = null,
    payload: Buffer;
  const entry = {
    method,
    path,
    actor: token === A ? "owner" : "foreign",
    expected,
    ...(o.raw ? { bodyBytes: o.raw.length, bodySha256: sha(o.raw) } : {}),
  };
  try {
    if (o.raw) {
      const r = await binaryRequest(
        base + path,
        method,
        {
          Authorization: "Bearer " + token,
          Connection: "close",
          "Content-Type": "application/octet-stream",
          ...(o.idem ? { "Idempotency-Key": o.idem } : {}),
          ...o.headers,
        },
        Buffer.from(o.raw),
      );
      status = r[0];
      payload = r[1];
    } else {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await api.request(method, path, o);
          status = r.status;
          payload = r.data;
          break;
        } catch (e) {
          if (e instanceof ResponseMismatch) {
            status = e.status;
            payload = Buffer.from(JSON.stringify(e.result));
            break;
          }
          if (method !== "GET" || attempt === 7) throw e;
          await sleep(2);
        }
      }
    }
  } catch (e) {
    appendFileSync(
      trace,
      JSON.stringify({
        ...entry,
        status: null,
        transport: e instanceof Error ? e.name : "unknown",
      }) + "\n",
    );
    throw e;
  }
  appendFileSync(trace, JSON.stringify({ ...entry, status }) + "\n");
  console.log(method, path, entry.actor, "expected", expected, "actual", status);
  assert.equal(status, expected);
  return payload;
}
const call = async (method: string, path: string, o: CallOptions = {}) =>
  JSON.parse((await request(method, path, o)).toString("utf8"));
const disk = readFileSync(process.argv[2]);
assert(disk.length >= 512 && disk.length <= 64 * 1024 ** 2);
const format = disk.subarray(0, 4).equals(Buffer.from([81, 70, 73, 251])) ? "qcow2" : "raw",
  digest = sha(disk);
const mediaSpec = {
  format,
  bytes: disk.length,
  sha256: digest,
  source:
    "quay.io/kubevirt/cirros-container-disk-demo@sha256:0e5ac38b20abcc7752293425b239a147868facd62cd5030dede6da6f2fc526a1",
  os: "CirrOS",
  version: "pinned-test-digest",
  authorizedByClient: true,
};
const aux = Buffer.concat([Buffer.from("VM-interface-secondary-disk"), Buffer.alloc(4096)]),
  auxsha = sha(aux);
const spec = {
  version: 1,
  name: "ci-upload",
  architecture: "amd64",
  cpu: 1,
  memoryMiB: 512,
  image: "uploaded-disk",
  storage: { systemGiB: 2, exchangeGiB: 1 },
  media: mediaSpec,
  firmware: "bios",
  ...(mode === "dual"
    ? {
        auxiliaryDisk: {
          sizeGiB: 1,
          media: {
            format: "raw",
            bytes: aux.length,
            sha256: auxsha,
            source: "CI-generated non-boot secondary disk",
            os: "fixture",
            version: "1",
            authorizedByClient: true,
          },
        },
      }
    : {}),
};
const bad = Buffer.from(disk);
bad[0] ^= 1;
let artifact: string | undefined,
  path: string | undefined,
  report: Record<string, unknown> | undefined;
const ready = async (p: string) =>
  wait(async () => (await call("GET", p)).ready, 300, "Verified CDI import did not converge", 3);
const uploadReady = async (p: string) =>
  wait(
    async () => (await call("GET", p)).phase === "UploadReady",
    300,
    "CDI did not reach UploadReady",
    3,
  );
try {
  if (mode === "url") {
    assert(
      digest === "7d6355852aeb6dbcd191bcda7cd74f1536cfe5cbf8a10495a7283a8396e4b75b" &&
        disk.length === 21692416,
    );
    mediaSpec.source = "https://download.cirros-cloud.net/0.6.3/cirros-0.6.3-x86_64-disk.img";
    mediaSpec.version = "0.6.3";
    const declaration = {
        metadata: mediaSpec,
        architecture: "amd64",
        licensing: "CirrOS project published free test image; client authorized",
      },
      idem = key();
    const registration = await call("POST", "/media-artifacts", {
      body: declaration,
      idem,
      expected: 202,
    });
    assert.deepEqual(
      await call("POST", "/media-artifacts", { body: declaration, idem, expected: 202 }),
      registration,
    );
    artifact = registration.result.id;
    const ap = "/media-artifacts/" + artifact;
    assert.equal((await call("GET", ap)).state, "registered");
    assert.deepEqual((await call("GET", "/media-artifacts", { token: B })).artifacts, []);
    await call("GET", ap, { token: B, expected: 404 });
    await call("PUT", ap + "/file", { token: B, raw: disk, idem: key(), expected: 404 });
    await call("PUT", ap + "/file", { raw: bad, idem: key(), expected: 422 });
    assert.equal((await call("GET", ap)).state, "registered");
    const k = key(),
      uploaded = await call("PUT", ap + "/file", { raw: disk, idem: k, expected: 202 });
    assert.equal(uploaded.result.state, "verified");
    assert.deepEqual(
      await call("PUT", ap + "/file", { raw: disk, idem: k, expected: 202 }),
      uploaded,
    );
    await call("PUT", ap + "/file", { raw: disk, idem: key(), expected: 409 });
    await call("DELETE", ap, { token: B, idem: key(), expected: 404 });
  }
  await call("POST", "/computers/plan", { body: spec });
  const created = await call("POST", "/computers", { body: spec, idem: key(), expected: 202 });
  path = "/computers/" + created.result.id;
  const p = path!,
    media = p + "/media";
  await call("POST", p + "/start", { body: {}, idem: key(), expected: 409 });
  await call("GET", media, { token: B, expected: 404 });
  await call("PUT", media + "/boot", { token: B, raw: disk, idem: key(), expected: 404 });
  await uploadReady(media);
  if (mode === "url") {
    await call("POST", media + "/boot/artifact", {
      token: B,
      body: { artifactId: artifact },
      idem: key(),
      expected: 404,
    });
    const k = key(),
      first = await call("POST", media + "/boot/artifact", {
        body: { artifactId: artifact },
        idem: k,
        expected: 202,
      });
    assert.equal(first.result.sha256, digest);
    assert.deepEqual(
      await call("POST", media + "/boot/artifact", {
        body: { artifactId: artifact },
        idem: k,
        expected: 202,
      }),
      first,
    );
  } else if (mode === "direct" || mode === "dual") {
    await call("PUT", media + "/boot", { raw: bad, idem: key(), expected: 422 });
    assert(!(await call("GET", media)).ready);
    const k = key(),
      first = await call("PUT", media + "/boot", { raw: disk, idem: k, expected: 202 });
    assert.equal(first.result.sha256, digest);
    assert.deepEqual(
      await call("PUT", media + "/boot", { raw: disk, idem: k, expected: 202 }),
      first,
    );
  } else {
    const chunk = (await call("GET", media)).chunkBytes;
    assert.equal(chunk, 8 * 1024 * 1024);
    const endpoint = media + "/boot/chunks",
      send = (offset: number, blob: Buffer, o: CallOptions = {}, digest = sha(blob)) =>
        call("PUT", endpoint, {
          raw: blob,
          idem: key(),
          expected: 202,
          ...o,
          headers: { "Upload-Offset": String(offset), "X-Content-SHA256": digest },
        });
    const firstChunk = disk.subarray(0, chunk);
    await call("POST", media + "/boot/commit", { idem: key(), expected: 409 });
    await send(0, firstChunk, { token: B, expected: 404 });
    await send(0, firstChunk, { expected: 422 }, "0".repeat(64));
    if (disk.length > chunk) await send(chunk, disk.subarray(chunk, 2 * chunk), { expected: 409 });
    const k = key(),
      first = await send(0, firstChunk, { idem: k });
    assert.equal(first.result.received, firstChunk.length);
    assert.deepEqual(await send(0, firstChunk, { idem: k }), first);
    assert.equal((await send(0, firstChunk)).result.replayed, true);
    const changed = Buffer.from(firstChunk);
    changed[0] ^= 1;
    await send(0, changed, { expected: 409 });
    assert.equal((await call("GET", media)).stagedBytes, firstChunk.length);
    assert.equal(
      (await call("DELETE", endpoint, { idem: key(), expected: 202 })).result.discarded,
      true,
    );
    assert.equal((await call("GET", media)).stagedBytes, 0);
    for (let offset = 0; offset < disk.length; offset += chunk)
      assert.equal(
        (await send(offset, disk.subarray(offset, offset + chunk))).result.received,
        Math.min(offset + chunk, disk.length),
      );
    assert.equal((await call("GET", media)).stagedBytes, disk.length);
    const idem = key(),
      committed = await call("POST", media + "/boot/commit", { idem, expected: 202 });
    assert.equal(committed.result.sha256, digest);
    assert.deepEqual(
      await call("POST", media + "/boot/commit", { idem, expected: 202 }),
      committed,
    );
  }
  await ready(media);
  if (mode === "dual") {
    await call("POST", p + "/start", { body: {}, idem: key(), expected: 409 });
    await call("GET", media + "/auxiliary", { token: B, expected: 404 });
    await uploadReady(media + "/auxiliary");
    await call("PUT", media + "/auxiliary", { raw: aux, idem: key(), expected: 202 });
    await ready(media + "/auxiliary");
    assert((await call("GET", media)).ready);
    assert.equal((await call("GET", media + "/auxiliary")).metadata.sha256, auxsha);
    assert.deepEqual(
      new Set((await call("GET", p + "/storage")).volumes.map((d: { kind: string }) => d.kind)),
      new Set(["boot", "exchange", "auxiliary"]),
    );
  }
  await call("POST", p + "/start", { body: {}, idem: key(), expected: 202 });
  await wait(
    async () => (await call("GET", p)).instance?.status.phase === "Running",
    420,
    "Imported VM did not run",
    3,
  );
  const screen = "evidence/imported-disk-" + mode + "-display.png";
  const png = await wait(
    async () => {
      const data = await request("GET", p + "/screenshot");
      assert(
        data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          data.length > 100,
      );
      writeFileSync(screen, data);
      return ocr(screen).includes("cirroslogin") ? data : null;
    },
    240,
    "Imported disk did not reach visible CirrOS login",
    3,
  );
  report = {
    scope: "real-api-upload",
    mode,
    format,
    bytes: disk.length,
    sha256: digest,
    verifiedCDI: true,
    badDigestDenied: true,
    crossAccountDenied: true,
    idempotent: true,
    screenshotSha256: sha(png),
    guestLoginVerified: true,
    commit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
  };
  if (artifact) {
    const uid = async (p: string) =>
      (await call("GET", p + "/storage")).volumes.find((v: { kind: string }) => v.kind === "boot")
        .pvcUid;
    const original = await uid(p);
    assert(original);
    const second = await call("POST", "/computers", {
        body: { ...spec, name: "ci-artifact-copy" },
        idem: key(),
        expected: 202,
      }),
      other = "/computers/" + second.result.id;
    try {
      await uploadReady(other + "/media");
      await call("POST", other + "/media/boot/artifact", {
        body: { artifactId: artifact },
        idem: key(),
        expected: 202,
      });
      await ready(other + "/media");
      const copy = await uid(other);
      assert(copy && copy !== original);
      await call("DELETE", "/media-artifacts/" + artifact, { idem: key(), expected: 202 });
      await call("GET", "/media-artifacts/" + artifact, { expected: 404 });
      assert((await call("GET", media)).ready && (await call("GET", other + "/media")).ready);
      assert.deepEqual((await call("GET", "/media-artifacts")).usage, { count: 0, bytes: 0 });
      writeJson("evidence/registered-artifact-verification.json", {
        artifactId: artifact,
        sha256: digest,
        bytes: disk.length,
        sourcePvcUid: original,
        copyPvcUid: copy,
        crossAccountDenied: true,
        badDigestDenied: true,
        immutable: true,
        deletedArtifactIndependentDisks: true,
      });
      artifact = undefined;
    } finally {
      await call("DELETE", other + "?deleteDisks=true", { idem: key(), expected: 202 });
    }
  }
  console.log(
    "Actual authorized disk bytes uploaded through API, verified by CDI and boot display captured",
  );
} finally {
  try {
    if (path) await call("DELETE", path + "?deleteDisks=true", { idem: key(), expected: 202 });
  } finally {
    if (artifact)
      await call("DELETE", "/media-artifacts/" + artifact, { idem: key(), expected: 202 });
  }
}
assert(report);
writeJson("evidence/media-" + mode + "-verification.json", {
  ...report,
  traceSha256: sha(readFileSync(trace)),
});
