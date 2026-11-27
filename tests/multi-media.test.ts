import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { computerSpec, vmManifest } from "../src/spec";
import { managedDisks } from "../src/storage";
import { mediaDeclaration } from "../src/media";
import { desiredUsage, specUsage } from "../src/quota";
const id = "vm-" + "a".repeat(32);
const media = {
  format: "qcow2",
  bytes: 1048576,
  sha256: "a".repeat(64),
  source: "authorized fixture",
  os: "Android",
  version: "1",
  authorizedByClient: true,
};
const base = {
  version: 1,
  name: "android",
  architecture: "arm64",
  cpu: 2,
  memoryMiB: 4096,
  image: "uploaded-disk",
  firmware: "uefi",
  storage: { systemGiB: 4, exchangeGiB: 1, exchangeMode: "virtiofs" },
  media,
  auxiliaryDisk: { sizeGiB: 2, media: { ...media, sha256: "b".repeat(64) } },
};
test("two ordered native disk slots with separate authorized VirtioFS volume and exact quota", () => {
  const s = computerSpec.parse(base),
    m = vmManifest(id, "alpha", s);
  assert.deepEqual(
    m.spec.template.spec.domain.devices.disks.map((d) => d.name),
    ["boot", "auxiliary"],
  );
  assert.deepEqual(
    managedDisks(m, id).map((d) => d.kind),
    ["boot", "exchange", "auxiliary"],
  );
  assert.equal(mediaDeclaration(m, id)?.metadata.sha256, media.sha256);
  assert.equal(mediaDeclaration(m, id, "auxiliary")?.metadata.sha256, "b".repeat(64));
  assert.equal(mediaDeclaration(m, id, "installer"), null);
  assert.equal(specUsage(s).storageGiB, 7);
  assert.deepEqual(desiredUsage(m.spec), specUsage(s));
});
test("auxiliary media cannot inject an ISO, raw source, or use SATA", () => {
  for (const changes of [
    { auxiliaryDisk: { ...base.auxiliaryDisk, media: { ...media, format: "iso" } } },
    { auxiliaryDisk: { ...base.auxiliaryDisk, url: "https://example.org" } },
    { bootBus: "sata" },
  ])
    assert.equal(computerSpec.safeParse({ ...base, ...changes }).success, false);
});

import { coldBootPatch } from "../src/boot";
test("Windows auxiliary driver ISO is read-only, nonbootable by explicit order and preserved by cold boot switch", () => {
  const s = computerSpec.parse({
    ...base,
    architecture: "amd64",
    image: "uploaded-installer",
    bootBus: "sata",
    media: { ...media, format: "iso", os: "Windows" },
    auxiliaryDisk: { sizeGiB: 1, media: { ...media, format: "iso", os: "Windows drivers" } },
  });
  const m = vmManifest(id, "alpha", s);
  const driver = m.spec.template.spec.domain.devices.disks.find((d) => d.name === "auxiliary");
  assert.deepEqual(driver, {
    name: "auxiliary",
    cdrom: { bus: "sata", readonly: true, tray: "closed" },
  });
  assert.equal(mediaDeclaration(m, id, "auxiliary")?.metadata.format, "iso");
  assert.equal(specUsage(s).storageGiB, 7);
  assert.deepEqual(desiredUsage(m.spec), specUsage(s));
  const vm = { ...m, metadata: { ...m.metadata, uid: "uid", resourceVersion: "1" }, status: {} };
  const patched = coldBootPatch(vm, null, { first: "system", expectedResourceVersion: "1" });
  assert.deepEqual(
    patched.spec.template.spec.domain.devices.disks.find((d) => d.name === "auxiliary"),
    driver,
  );
  assert.equal(
    computerSpec.safeParse({
      ...s,
      auxiliaryDisk: { ...s.auxiliaryDisk, media: { ...media, format: "qcow2" } },
    }).success,
    false,
  );
  assert.equal(
    computerSpec.safeParse({
      ...s,
      auxiliaryDisk: { sizeGiB: 1, media: { ...media, format: "iso", bytes: 2 * 1024 ** 3 } },
    }).success,
    false,
  );
});
