/** Read bounded compiled Android manifest metadata independently of the SDK. */
import assert from "node:assert/strict";
import { ZipReader } from "./zip-reader.ts";
export const MAX_MANIFEST = 256 * 1024,
  ANDROID_NS = "http://schemas.android.com/apk/res/android",
  NONE = 0xffffffff;
export function manifestMetadata(raw: Buffer) {
  assert(raw.length >= 8 && raw.length <= MAX_MANIFEST, "Invalid manifest length");
  assert(
    raw.readUInt16LE(0) === 3 && raw.readUInt16LE(2) === 8 && raw.readUInt32LE(4) === raw.length,
    "Expected compiled Android XML",
  );
  let strings: string[] | undefined;
  const str = (index: number) => {
    if (index === NONE) return null;
    assert(strings && index < strings.length, "Invalid manifest string reference");
    return strings[index];
  };
  for (let offset = 8; offset < raw.length;) {
    const kind = raw.readUInt16LE(offset),
      header = raw.readUInt16LE(offset + 2),
      size = raw.readUInt32LE(offset + 4);
    assert(header >= 8 && header <= size && offset + size <= raw.length, "Invalid manifest chunk");
    const d = raw.subarray(offset, offset + size);
    if (kind === 1) {
      assert(!strings && header >= 28, "Invalid manifest string pool");
      const count = d.readUInt32LE(8),
        styles = d.readUInt32LE(12),
        flags = d.readUInt32LE(16),
        start = d.readUInt32LE(20),
        limit = d.readUInt32LE(24) || d.length;
      assert(
        count <= 4096 &&
          header + 4 * (count + styles) <= start &&
          start <= limit &&
          limit <= d.length,
        "Invalid manifest string pool bounds",
      );
      strings = [];
      for (let i = 0; i < count; i++) {
        let p = start + d.readUInt32LE(header + 4 * i);
        assert(p >= start && p < limit, "Invalid manifest string offset");
        const length8 = () => {
          assert(p < limit, "Truncated manifest field");
          const n = d[p++];
          if (!(n & 128)) return n;
          assert(p < limit, "Truncated manifest field");
          return ((n & 127) << 8) | d[p++];
        };
        if (flags & 0x100) {
          length8();
          const n = length8();
          assert(p + n < limit && d[p + n] === 0, "Invalid UTF-8 string");
          strings.push(new TextDecoder("utf-8", { fatal: true }).decode(d.subarray(p, p + n)));
        } else {
          let n = d.readUInt16LE(p);
          p += 2;
          if (n & 0x8000) {
            n = (n & 0x7fff) * 65536 + d.readUInt16LE(p);
            p += 2;
          }
          assert(
            p + 2 * n + 2 <= limit && d.readUInt16LE(p + 2 * n) === 0,
            "Invalid UTF-16 string",
          );
          strings.push(
            new TextDecoder("utf-16le", { fatal: true }).decode(d.subarray(p, p + 2 * n)),
          );
        }
      }
    } else if (kind === 0x102) {
      assert(header === 16 && strings, "Invalid manifest root element");
      const ns = d.readUInt32LE(header),
        name = d.readUInt32LE(header + 4),
        start = d.readUInt16LE(header + 8),
        stride = d.readUInt16LE(header + 10),
        count = d.readUInt16LE(header + 12);
      assert(
        str(ns) === null &&
          str(name) === "manifest" &&
          start >= 20 &&
          stride === 20 &&
          count <= 128 &&
          header + start + stride * count <= size,
        "Invalid manifest root attributes",
      );
      const attrs = new Map<string, string | number | null>();
      for (let i = 0; i < count; i++) {
        const p = header + start + i * stride,
          key = JSON.stringify([str(d.readUInt32LE(p)), str(d.readUInt32LE(p + 4))]),
          rawValue = d.readUInt32LE(p + 8),
          type = d[p + 15],
          value = d.readUInt32LE(p + 16);
        assert(
          !attrs.has(key) && d.readUInt16LE(p + 12) === 8 && d[p + 14] === 0,
          "Invalid or duplicate manifest attribute",
        );
        const decoded = type === 3 ? str(value) : type === 16 ? value : null;
        if (rawValue !== NONE && type === 3)
          assert(str(rawValue) === decoded, "Conflicting manifest attribute");
        attrs.set(key, decoded);
      }
      return {
        package: attrs.get(JSON.stringify([null, "package"])),
        versionName: attrs.get(JSON.stringify([ANDROID_NS, "versionName"])),
        versionCode: attrs.get(JSON.stringify([ANDROID_NS, "versionCode"])),
      };
    }
    offset += size;
  }
  throw Error("Missing compiled manifest root");
}
export async function verifyProofApkMetadata(path: string) {
  const archive = new ZipReader(path, 4096);
  try {
    const entries = archive.entries.filter((e) => e.name === "AndroidManifest.xml");
    assert(
      entries.length === 1 && entries[0].size >= 8 && entries[0].size <= MAX_MANIFEST,
      "Missing, duplicate or oversized APK manifest",
    );
    const info = manifestMetadata(await archive.buffer(entries[0], MAX_MANIFEST));
    assert.deepEqual(
      info,
      { package: "org.vminterface.proof", versionName: "3.0", versionCode: 3 },
      "Unexpected signed proof APK package or version",
    );
    return info;
  } finally {
    archive.close();
  }
}
