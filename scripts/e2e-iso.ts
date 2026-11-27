/** API-only installer CD-ROM proof. GRUB boot marker, not OS installation. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  client,
  key,
  sha,
  wait,
  writeJson,
  sleep,
  ResponseMismatch,
  type CallOptions,
} from "./api-client.ts";
import { binaryRequest } from "./media-http.ts";
import { readMarker } from "./iso-marker.ts";
const base = process.env.API_URL ?? "http://127.0.0.1:3000/api/v1",
  { call: api, request, A, B } = client({ timeout: 240 });
async function call(method: string, path: string, o: CallOptions = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await api(method, path, o);
    } catch (e) {
      if (
        method !== "GET" ||
        (e instanceof ResponseMismatch && ![502, 503, 504].includes(e.status)) ||
        attempt === 7
      )
        throw e;
      await sleep(2);
    }
  }
  throw Error("Read transport did not recover");
}
async function upload(path: string, disk: Buffer) {
  const [status, payload] = await binaryRequest(
    base + path,
    "PUT",
    {
      Authorization: "Bearer " + A,
      Connection: "close",
      "Idempotency-Key": key(),
      "Content-Type": "application/octet-stream",
    },
    disk,
  );
  assert.equal(status, 202);
  return JSON.parse(payload.toString());
}
const disk = readFileSync(process.argv[2]);
assert(
  disk.length > 32768 && disk.length <= 64 * 1024 ** 2,
  "Fixture must fit bounded media profile",
);
const digest = sha(disk),
  results: Record<string, unknown>[] = [];
const poll = <T>(fn: () => T | Promise<T>, seconds: number, reason: string) =>
  wait(fn, seconds, reason, 3);
for (const firmware of ["bios", "uefi"]) {
  const mediaSpec = {
    format: "iso",
    bytes: disk.length,
    sha256: digest,
    source: "CI-generated GRUB fixture from distribution packages",
    os: "GRUB boot evidence only",
    version: "1",
    authorizedByClient: true,
  };
  const spec = {
    version: 1,
    name: "ci-iso-" + firmware,
    architecture: "amd64",
    cpu: 1,
    memoryMiB: 768,
    image: "uploaded-installer",
    storage: { systemGiB: 2, exchangeGiB: 1 },
    media: mediaSpec,
    firmware,
    auxiliaryDisk: { sizeGiB: 1, media: { ...mediaSpec, os: "auxiliary read-only fixture" } },
  };
  const quotaBefore = (await call("GET", "/account/quota")).usage.storageGiB;
  await call("POST", "/computers/plan", { body: spec });
  const created = await call("POST", "/computers", { body: spec, idem: key(), expected: 202 }),
    path = "/computers/" + created.result.id,
    media = path + "/media",
    pngfile = "evidence/iso-" + firmware + "-display.png";
  try {
    await call("POST", path + "/start", { body: {}, idem: key(), expected: 409 });
    await call("GET", media, { token: B, expected: 404 });
    await poll(
      async () => (await call("GET", media)).phase === "UploadReady",
      300,
      "ISO not upload ready",
    );
    assert.equal((await upload(media + "/installer", disk)).result.sha256, digest);
    await poll(async () => (await call("GET", media)).ready, 300, "ISO import not verified");
    await call("POST", path + "/start", { body: {}, idem: key(), expected: 409 });
    await poll(
      async () => (await call("GET", media + "/auxiliary")).phase === "UploadReady",
      300,
      "Driver ISO not upload ready",
    );
    assert.equal((await upload(media + "/auxiliary", disk)).result.sha256, digest);
    await poll(
      async () => (await call("GET", media + "/auxiliary")).ready,
      300,
      "Driver ISO not verified",
    );
    await call("POST", path + "/start", { body: {}, idem: key(), expected: 202 });
    const running = async () => (await call("GET", path)).instance?.status?.phase === "Running";
    await poll(running, 420, "Installer VM did not run");
    async function marker() {
      let png: Buffer;
      try {
        png = (await request("GET", path + "/screenshot")).data;
      } catch (e) {
        if (e instanceof ResponseMismatch && [409, 502, 503, 504].includes(e.status)) return false;
        throw e;
      }
      assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
      writeFileSync(pngfile, png);
      const [verified, text] = readMarker(pngfile);
      writeFileSync(pngfile.replace(/\.png$/, ".ocr.txt"), text);
      return verified;
    }
    await poll(marker, 180, "No installer boot marker in actual API screenshots");
    const result = {
      firmware,
      bytes: disk.length,
      sha256: digest,
      guestVisibleBootMarker: true,
      screenshotSha256: sha(readFileSync(pngfile)),
      osInstallationVerified: false,
      coldTrayDesiredStateAndReinsertBootVerified: false,
    };
    results.push(result);
    console.log("Actual " + firmware + " installer CD-ROM boot marker visible through API");
    await call("POST", path + "/stop", { body: {}, idem: key(), expected: 202 });
    await poll(
      async () => (await call("GET", path)).instance === null,
      240,
      "Stop did not converge",
    );
    await poll(
      async () => {
        const v = await call("GET", path),
          s = v.status ?? {};
        return (
          v.instance === null &&
          v.desired.runStrategy === "Halted" &&
          !s.created &&
          !s.ready &&
          !s.stateChangeRequests?.length
        );
      },
      120,
      "VM not fully halted",
    );
    let current = await call("GET", path);
    const change = {
        first: "system",
        installerTray: "open",
        expectedResourceVersion: current.resourceVersion,
      },
      planned = await call("POST", path + "/boot/plan", { body: change });
    assert.equal(planned.installerTray, "open");
    assert.equal((await call("GET", path)).resourceVersion, current.resourceVersion);
    await call("PATCH", path + "/boot", { body: change, idem: key(), expected: 202 });
    current = await call("GET", path);
    const disks = current.desired.template.spec.domain.devices.disks as {
      name: string;
      cdrom: { tray: string; readonly: boolean };
      bootOrder?: number;
    }[];
    assert.equal(disks.find((d) => d.name === "installer")?.cdrom.tray, "open");
    const driver = disks.find((d) => d.name === "auxiliary");
    assert(driver?.cdrom.readonly === true && !("bootOrder" in driver));
    await call("PATCH", path + "/boot", {
      body: { first: "installer", expectedResourceVersion: current.resourceVersion },
      idem: key(),
      expected: 422,
    });
    await call("PATCH", path + "/boot", {
      body: {
        first: "installer",
        installerTray: "closed",
        expectedResourceVersion: current.resourceVersion,
      },
      idem: key(),
      expected: 202,
    });
    await call("POST", path + "/start", { body: {}, idem: key(), expected: 202 });
    await poll(running, 420, "Reinserted installer VM did not run");
    await poll(marker, 180, "Reinserted installer boot not visible");
    result.coldTrayDesiredStateAndReinsertBootVerified = true;
    result.screenshotSha256 = sha(readFileSync(pngfile));
  } finally {
    const deleted = await call("DELETE", path + "?deleteDisks=true", {
      idem: key(),
      expected: 202,
    });
    await poll(
      async () =>
        (await call("GET", "/operations/" + deleted.operationId)).observation?.state ===
        "converged",
      300,
      "ISO VM/storage deletion did not converge",
    );
    assert.equal((await call("GET", "/account/quota")).usage.storageGiB, quotaBefore);
  }
}
writeJson("evidence/iso-boot-verification.json", { scope: "real-api-CDROM-boot-only", results });
