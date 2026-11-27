/** Offline bounded preparation of the authorized pinned two-disk Android bundle. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileSha256, isMain } from "./tooling.ts";
import { ZipReader } from "./zip-reader.ts";
export const GIB = 1024 ** 3,
  MAX_DISK_BYTES = 8 * GIB,
  MAX_VIRTUAL_BYTES = 64 * GIB;
export const SOURCE =
  "https://github.com/jqssun/android-lineage-qemu/releases/download/v2026.10.18/UTM-VM-lineage-23.2-20261019-jqssun-virtio_arm64only.zip";
export const ARCHIVE_SHA = "171c0d215899d68f070fd45aea05ddb25737cf4ff16a25468e7cafbc65f4d8c9",
  ARCHIVE_SIZE = 1121501784;
export function qcowCapacity(header: Buffer) {
  assert(
    header.length >= 72 && header.subarray(0, 4).equals(Buffer.from([0x51, 0x46, 0x49, 0xfb])),
    "Not a QCOW2 image",
  );
  const version = header.readUInt32BE(4),
    backing = header.readBigUInt64BE(8),
    backingLen = header.readUInt32BE(16),
    cluster = header.readUInt32BE(20),
    size = Number(header.readBigUInt64BE(24)),
    crypt = header.readUInt32BE(32);
  assert(
    (version === 2 || version === 3) && backing === 0n && !backingLen && !crypt,
    "Unsupported backing chain, format or encryption",
  );
  assert(cluster >= 9 && cluster <= 21, "Invalid cluster bits");
  if (version === 3)
    assert(
      header.length >= 104 &&
        (header.readBigUInt64BE(72) & ~24n) === 0n &&
        header.readUInt32BE(100) >= 104 &&
        header.readUInt32BE(100) <= 2 ** cluster,
      "Unsupported QCOW2 v3 features or header length",
    );
  assert(
    Number.isSafeInteger(size) && size >= 512 && size <= MAX_VIRTUAL_BYTES && size % 512 === 0,
    "Invalid virtual capacity",
  );
  const capacity = Math.ceil((size + 64 * 1024 ** 2) / (0.9 * GIB));
  assert(capacity <= 64, "Virtual disk exceeds supported PVC capacity");
  return [size, capacity] as const;
}
type Disk = { bytes: number; sha256: string; virtualBytes: number; sizeGiB: number };
export async function prepare(
  archive: string,
  expectedSha: string,
  output: string,
  checkDisk: (path: string, size: number) => void,
) {
  assert(fileSha256(archive) === expectedSha, "Archive digest mismatch");
  assert(!existsSync(output), "Output already exists; refusing overwrite");
  mkdirSync(dirname(output), { recursive: true });
  const temp = mkdtempSync(join(dirname(output), ".vm-android-")),
    work = join(temp, "disks");
  mkdirSync(work, { mode: 0o700 });
  try {
    const bundle = new ZipReader(archive, 256);
    const records: Record<string, Disk> = {};
    try {
      const selected = new Map<string, (typeof bundle.entries)[number]>();
      for (const m of bundle.entries) {
        const parts = m.name.split("/");
        assert(
          !posix.isAbsolute(m.name) && !parts.includes("..") && !m.name.includes("\\"),
          "Unsafe archive path",
        );
        const name = posix.basename(m.name);
        if (!["vda.qcow2", "vdb.qcow2"].includes(name)) continue;
        assert(
          posix.basename(posix.dirname(m.name)) === "Data" &&
            !selected.has(name) &&
            ((m.attributes >>> 16) & 0xf000) !== 0xa000,
          "Unexpected or duplicate disk entry",
        );
        assert(m.size >= 104 && m.size <= MAX_DISK_BYTES, "Disk archive member exceeds bound");
        selected.set(name, m);
      }
      assert(
        selected.size === 2 &&
          new Set([...selected.values()].map((m) => posix.dirname(m.name))).size === 1,
        "Exactly two disks in one VM bundle required",
      );
      for (const [name, m] of selected) {
        const dest = join(work, name);
        await bundle.file(m, MAX_DISK_BYTES, dest);
        const fd = openSync(dest, "r"),
          head = Buffer.alloc(104);
        try {
          assert(readSync(fd, head, 0, 104, 0) === 104, "Truncated QCOW2");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        const [size, capacity] = qcowCapacity(head);
        checkDisk(dest, size);
        records[name] = {
          bytes: statSync(dest).size,
          sha256: fileSha256(dest),
          virtualBytes: size,
          sizeGiB: capacity,
        };
      }
    } finally {
      bundle.close();
    }
    writeFileSync(join(work, "disks.json"), JSON.stringify(records, null, 2) + "\n", {
      flag: "wx",
    });
    assert(!existsSync(output), "Output already exists");
    renameSync(work, output);
    return records;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
export function checkQemu(path: string, size: number) {
  const info = JSON.parse(
    execFileSync("qemu-img", ["info", "-f", "qcow2", "--output=json", path], {
      encoding: "utf8",
      timeout: 60000,
    }),
  );
  assert(
    info.format === "qcow2" &&
      info["virtual-size"] === size &&
      !info["backing-filename"] &&
      !info.encrypted,
    "Unexpected qemu-img metadata",
  );
  execFileSync("qemu-img", ["check", "-f", "qcow2", path], {
    timeout: 300000,
    stdio: ["ignore", "ignore", "inherit"],
  });
}
if (isMain(import.meta.url)) {
  const [archive, output, authorization, ...rest] = process.argv.slice(2);
  assert(
    archive && output && authorization === "--authorized" && !rest.length,
    "Explicit archive authorization required",
  );
  assert(statSync(archive).size === ARCHIVE_SIZE, "Wrong pinned archive size");
  const disks = await prepare(archive, ARCHIVE_SHA, output, checkQemu);
  console.log(
    JSON.stringify(
      {
        source: SOURCE,
        archiveSha256: ARCHIVE_SHA,
        architecture: "arm64",
        disks,
        bootCertified: false,
      },
      null,
      2,
    ),
  );
}
