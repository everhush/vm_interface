import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  digest,
  deviceState,
  requireGuestSecurity,
  verifyStagedBundle,
} from "../scripts/android-guest-transfer.ts";
function bundle(data: Record<string, Buffer>, extra = false) {
  const members: Record<string, Buffer> = Object.fromEntries(
    Object.entries(data).map(([k, v]) => ["upload/" + k, v]),
  );
  members["manifest.json"] = Buffer.from(
    JSON.stringify({
      version: 1,
      scope: "published-exchange-files-only",
      files: Object.entries(data).map(([n, b]) => ({
        name: "upload/" + n,
        bytes: b.length,
        sha256: digest(b),
        direction: "upload",
      })),
    }),
  );
  if (extra) members["../escape"] = Buffer.from("x");
  const parts: Buffer[] = [];
  for (const [name, bytes] of Object.entries(members)) {
    const h = Buffer.alloc(512);
    h.write(name);
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.fill(32, 148, 156);
    h[156] = 48;
    h.write("ustar\0", 257);
    h.write("00", 263);
    h.write(
      h
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
    );
    parts.push(h, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
test("exact staged API bundle bytes and no extra entries", () => {
  const data = { "proof.apk": Buffer.from("apk"), "challenge.bin": Buffer.from("random") };
  assert.deepEqual(verifyStagedBundle(bundle(data), data), data);
  assert.throws(() => verifyStagedBundle(bundle(data, true), data));
  assert.throws(() =>
    verifyStagedBundle(bundle({ ...data, "proof.apk": Buffer.from("bad") }), data),
  );
});
test("explicit fresh key and secure guest ABI", () => {
  const serial = "127.0.0.1:1234";
  assert.equal(
    deviceState(Buffer.from("List of devices attached\n" + serial + "\tunauthorized\n"), serial),
    "unauthorized",
  );
  assert.throws(() => deviceState(Buffer.from("List of devices attached\nUSB\tdevice\n"), serial));
  requireGuestSecurity("1", "Enforcing", "2000", "arm64-v8a");
  for (const args of [
    ["0", "Enforcing", "2000", "arm64-v8a"],
    ["1", "Permissive", "2000", "arm64-v8a"],
    ["1", "Enforcing", "0", "arm64-v8a"],
    ["1", "Enforcing", "2000", "x86_64"],
  ] as const)
    assert.throws(() => requireGuestSecurity(args[0], args[1], args[2], args[3]));
});
