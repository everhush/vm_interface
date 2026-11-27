import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { publish, download, listFiles, exchangeBundle } from "../src/exchange-files";
import { exchangeFileName, exchangePod, exchangePVC } from "../src/exchange";
import { computerSpec, vmManifest } from "../src/spec";
import { desiredUsage } from "../src/quota";
import { managedDisks } from "../src/storage";
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test("VirtioFS uses distinct owned PVC and counts all reservations", () => {
  const id = "vm-" + "a".repeat(32);
  const s = computerSpec.parse({
    version: 1,
    name: "test",
    architecture: "amd64",
    image: "fedora-exchange-test",
    cpu: 1,
    memoryMiB: 1536,
    storage: { systemGiB: 4, exchangeGiB: 1, exchangeMode: "virtiofs" },
  });
  const m = vmManifest(id, "alpha", s);
  assert.equal(m.spec.dataVolumeTemplates?.length, 1);
  assert.equal(desiredUsage(m.spec).storageGiB, 5);
  assert.equal(managedDisks(m, id)[1].mode, "virtiofs");
  const p = exchangePod(id, "alpha", "uid", "a".repeat(43));
  assert.equal(p.spec.automountServiceAccountToken, false);
  assert.deepEqual(p.spec.containers[0].command, [
    "node",
    "--import",
    "vite-plus/register",
    "src/run-exchange-broker.ts",
  ]);
  assert.deepEqual(p.spec.containers[0].env, [
    { name: "EXCHANGE_TOKEN", value: "a".repeat(43) },
    { name: "NODE_DISABLE_COMPILE_CACHE", value: "1" },
  ]);
  const policy = readFileSync(new URL("../infra/exchange-policy.yaml", import.meta.url), "utf8");
  assert.ok(
    policy.includes(
      "command == [\x27node\x27,\x27--import\x27,\x27vite-plus/register\x27,\x27src/run-exchange-broker.ts\x27]",
    ),
  );
  assert.ok(policy.includes("c.env[1].name == \x27NODE_DISABLE_COMPILE_CACHE\x27"));
  assert.ok(policy.includes("!has(c.env[1].valueFrom)"));
  assert.equal(p.spec.volumes[0].persistentVolumeClaim.claimName, id + "-exchange");
  assert.equal(exchangePVC(id, "alpha", "uid", "1").metadata.ownerReferences[0].uid, "uid");
  assert.equal(computerSpec.safeParse({ ...s, image: "cirros-smoke" }).success, false);
});
test("exchange accepts bytes only with checksum and refuses symlinks, traversal and incomplete output", async () => {
  const root = await mkdtemp(join(tmpdir(), "vm-exchange-"));
  try {
    const data = Buffer.from([0, 1, 2, 255, 10]);
    await publish(root, "hello.bin", data, digest(data));
    await publish(root, "hello.bin", data, digest(data));
    await assert.rejects(
      () => publish(root, "hello.bin", Buffer.from("x"), digest(Buffer.from("x"))),
      { status: 409 },
    );
    await assert.rejects(() => publish(root, "bad", data, "0".repeat(64)), { status: 422 });
    assert.throws(() => exchangeFileName("../x"), { status: 422 });
    await writeFile(join(root, "out-reply"), data);
    await assert.rejects(() => download(root, "reply"), { status: 404 });
    await writeFile(join(root, "out-reply.sha256"), digest(data));
    assert.deepEqual((await download(root, "reply")).bytes, data);
    await symlink("/etc/passwd", join(root, "out-secret"));
    await writeFile(join(root, "out-secret.sha256"), digest(data));
    await assert.rejects(() => download(root, "secret"), { status: 404 });
    assert.deepEqual(
      (await listFiles(root)).map((x) => x.name),
      ["reply"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("halted exchange bundle contains exactly safe published bytes and checksum manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "vm-bundle-"));
  try {
    const data = Buffer.from([0, 255, 1, 2]);
    await publish(root, "a".repeat(96), data, digest(data));
    await writeFile(join(root, "out-result"), data);
    await writeFile(join(root, "out-result.sha256"), digest(data));
    await writeFile(join(root, ".unpublished"), "private temporary");
    const b = await exchangeBundle(root),
      again = await exchangeBundle(root);
    assert.equal(b.sha256, digest(b.bytes));
    assert.deepEqual(b, again);
    const records = new Map<string, Buffer>();
    for (let i = 0; i < b.bytes.length - 1024;) {
      const h = b.bytes.subarray(i, i + 512),
        field = (start: number, end: number) =>
          h.subarray(start, end).toString("ascii").replace(/\0.*$/s, "");
      const size = parseInt(field(124, 136), 8),
        name = field(345, 500),
        sum = parseInt(field(148, 156), 8);
      const copy = Buffer.from(h);
      copy.fill(32, 148, 156);
      assert.equal(
        copy.reduce((n, x) => n + x, 0),
        sum,
      );
      records.set(
        (name ? name + "/" : "") + field(0, 100),
        b.bytes.subarray(i + 512, i + 512 + size),
      );
      i += 512 + Math.ceil(size / 512) * 512;
    }
    assert.deepEqual(records.get("upload/" + "a".repeat(96)), data);
    assert.deepEqual(records.get("download/result"), data);
    const manifest = JSON.parse(records.get("manifest.json")!.toString());
    assert.equal(manifest.scope, "published-exchange-files-only");
    assert.equal(manifest.files.length, 2);
    assert.ok(manifest.files.every((f: { sha256: string }) => f.sha256 === digest(data)));
    await writeFile(join(root, "out-incomplete"), data);
    await assert.rejects(() => exchangeBundle(root), { status: 409 });
    await rm(join(root, "out-incomplete"));
    await symlink("/etc/passwd", join(root, "in-escape"));
    await assert.rejects(() => exchangeBundle(root), { status: 404 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("exchange bundle refuses oversized output rather than silently truncating", async () => {
  const root = await mkdtemp(join(tmpdir(), "vm-bundle-limit-"));
  try {
    const data = Buffer.alloc(8 * 1024 * 1024);
    for (let i = 0; i < 4; i++) await publish(root, "large" + i, data, digest(data));
    await assert.rejects(() => exchangeBundle(root), { status: 413 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
