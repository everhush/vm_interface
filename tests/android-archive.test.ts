import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { ZipReader } from "../scripts/zip-reader.ts";
import { prepare, qcowCapacity } from "../scripts/prepare-android.ts";
import {
  manifestMetadata,
  verifyProofApkMetadata,
  ANDROID_NS,
  NONE,
} from "../scripts/apk-manifest-check.ts";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function zip(entries: { name: string; data: Buffer; attributes?: number; badCrc?: boolean }[]) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name),
      payload = deflateRawSync(e.data),
      crc = e.badCrc ? 0 : crc32(e.data),
      h = Buffer.alloc(30),
      c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(payload.length, 18);
    h.writeUInt32LE(e.data.length, 22);
    h.writeUInt16LE(name.length, 26);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(payload.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(e.attributes ?? 0, 38);
    c.writeUInt32LE(offset, 42);
    local.push(h, name, payload);
    central.push(c, name);
    offset += h.length + name.length + payload.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function header(backing = 0) {
  const b = Buffer.alloc(104);
  Buffer.from([81, 70, 73, 251]).copy(b);
  b.writeUInt32BE(3, 4);
  b.writeBigUInt64BE(BigInt(backing), 8);
  b.writeUInt32BE(16, 20);
  b.writeBigUInt64BE(1024n ** 3n, 24);
  b.writeUInt32BE(104, 100);
  return b;
}
function apkManifest(utf8 = false, pkg = "org.vminterface.proof") {
  const values = ["manifest", "package", pkg, ANDROID_NS, "versionName", "3.0", "versionCode"];
  const offsets: number[] = [],
    parts: Buffer[] = [];
  let n = 0;
  for (const s of values) {
    offsets.push(n);
    const body = Buffer.from(s, utf8 ? "utf8" : "utf16le"),
      len = Buffer.alloc(2);
    if (utf8) {
      len[0] = s.length;
      len[1] = body.length;
    } else len.writeUInt16LE(s.length);
    const b = Buffer.concat([len, body, Buffer.alloc(utf8 ? 1 : 2)]);
    parts.push(b);
    n += b.length;
  }
  const start = 28 + 4 * offsets.length,
    pool = Buffer.alloc(start);
  pool.writeUInt16LE(1);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(start + n, 4);
  pool.writeUInt32LE(offsets.length, 8);
  pool.writeUInt32LE(utf8 ? 0x100 : 0, 16);
  pool.writeUInt32LE(start, 20);
  offsets.forEach((v, i) => pool.writeUInt32LE(v, 28 + i * 4));
  const node = Buffer.alloc(96);
  node.writeUInt16LE(0x102);
  node.writeUInt16LE(16, 2);
  node.writeUInt32LE(96, 4);
  node.writeUInt32LE(1, 8);
  node.writeUInt32LE(NONE, 12);
  node.writeUInt32LE(NONE, 16);
  node.writeUInt16LE(20, 24);
  node.writeUInt16LE(20, 26);
  node.writeUInt16LE(3, 28);
  [
    [NONE, 1, 3, 2],
    [3, 4, 3, 5],
    [3, 6, 16, 3],
  ].forEach(([ns, name, kind, value], i) => {
    const p = 36 + 20 * i;
    node.writeUInt32LE(ns, p);
    node.writeUInt32LE(name, p + 4);
    node.writeUInt32LE(NONE, p + 8);
    node.writeUInt16LE(8, p + 12);
    node[p + 15] = kind;
    node.writeUInt32LE(value, p + 16);
  });
  const root = Buffer.alloc(8);
  root.writeUInt16LE(3);
  root.writeUInt16LE(8, 2);
  root.writeUInt32LE(8 + start + n + 96, 4);
  return Buffer.concat([root, pool, ...parts, node]);
}
async function temp(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "android-archive-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("exact two Android disks with no unrelated extraction", () =>
  temp(async (dir) => {
    const raw = zip([
        { name: "fixture.utm/Data/vda.qcow2", data: header() },
        { name: "fixture.utm/Data/vdb.qcow2", data: header() },
        { name: "fixture.utm/config.plist", data: Buffer.from("ignore") },
      ]),
      p = join(dir, "a.zip"),
      out = join(dir, "out");
    writeFileSync(p, raw);
    const checked: string[] = [];
    const r = await prepare(p, sha(raw), out, (path, size) => {
      assert.equal(size, 1024 ** 3);
      checked.push(path);
    });
    assert.deepEqual(Object.keys(r).sort(), ["vda.qcow2", "vdb.qcow2"]);
    assert.deepEqual(readdirSync(out).sort(), ["disks.json", "vda.qcow2", "vdb.qcow2"]);
    assert.equal(checked.length, 2);
    assert.equal(r["vda.qcow2"].sizeGiB, 2);
    await assert.rejects(
      prepare(p, sha(raw), out, () => {}),
      /already exists/,
    );
  }));
test("reject wrong digest, traversal, duplicate and symlink disks, backing chains", () =>
  temp(async (dir) => {
    const entries = [
        { name: "fixture.utm/Data/vda.qcow2", data: header() },
        { name: "fixture.utm/Data/vdb.qcow2", data: header() },
      ],
      p = join(dir, "a.zip"),
      out = join(dir, "out");
    const raw = zip(entries);
    writeFileSync(p, raw);
    await assert.rejects(
      prepare(p, "0".repeat(64), out, () => {}),
      /digest/,
    );
    for (const e of [
      { name: "../escape", data: header() },
      { name: "other.utm/Data/vda.qcow2", data: header() },
    ]) {
      const b = zip([...entries, e]);
      writeFileSync(p, b);
      await assert.rejects(prepare(p, sha(b), out, () => {}));
      assert(!existsSync(out));
    }
    const b = zip([{ ...entries[0], attributes: 0xa0000000 }, entries[1]]);
    writeFileSync(p, b);
    await assert.rejects(prepare(p, sha(b), out, () => {}));
    assert.throws(() => qcowCapacity(header(100)), /backing/);
  }));
test("ZIP rejects CRC corruption and extraction beyond bounds", () =>
  temp(async (dir) => {
    const p = join(dir, "bad.zip");
    writeFileSync(p, zip([{ name: "a", data: Buffer.from("abcd"), badCrc: true }]));
    const z = new ZipReader(p);
    try {
      await assert.rejects(z.buffer(z.entries[0], 3), /bounds/);
      await assert.rejects(z.buffer(z.entries[0], 4), /CRC/);
    } finally {
      z.close();
    }
  }));
test("APK compiled UTF-8 and UTF-16 pools and exact package/version", () =>
  temp(async (dir) => {
    const p = join(dir, "proof.apk");
    for (const utf8 of [false, true]) {
      writeFileSync(p, zip([{ name: "AndroidManifest.xml", data: apkManifest(utf8) }]));
      assert.deepEqual(await verifyProofApkMetadata(p), {
        package: "org.vminterface.proof",
        versionName: "3.0",
        versionCode: 3,
      });
    }
    assert.throws(() => manifestMetadata(apkManifest().subarray(0, -1)));
    writeFileSync(
      p,
      zip([{ name: "AndroidManifest.xml", data: apkManifest(false, "wrong.package") }]),
    );
    await assert.rejects(verifyProofApkMetadata(p));
    writeFileSync(
      p,
      zip([
        { name: "AndroidManifest.xml", data: apkManifest() },
        { name: "AndroidManifest.xml", data: apkManifest() },
      ]),
    );
    await assert.rejects(verifyProofApkMetadata(p), /duplicate/);
  }));
