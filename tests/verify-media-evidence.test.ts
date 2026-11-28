import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyMedia, OCI_SHA, OCI_BYTES } from "../scripts/verify_media_evidence.ts";
function temporary(fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "vm-media-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const proof = {
  commit: "a".repeat(40),
  runId: "123",
  mode: "direct",
  sha256: OCI_SHA,
  bytes: OCI_BYTES,
  verifiedCDI: true,
  badDigestDenied: true,
  crossAccountDenied: true,
  idempotent: true,
  guestLoginVerified: true,
  screenshotSha256: "a".repeat(64),
};
test("incomplete artifact rejected", () =>
  temporary((root) => assert.throws(() => verifyMedia(root, "a".repeat(40), "123"), /ENOENT/)));
test("mixed commit rejected", () =>
  temporary((root) => {
    writeFileSync(
      join(root, "media-direct-verification.json"),
      JSON.stringify({ commit: "b".repeat(40), runId: "123", mode: "direct" }),
    );
    assert.throws(() => verifyMedia(root, "a".repeat(40), "123"), /Wrong media execution/);
  }));
test("reported success cannot substitute missing screenshot", () =>
  temporary((root) => {
    writeFileSync(join(root, "media-direct-verification.json"), JSON.stringify(proof));
    assert.throws(() => verifyMedia(root, "a".repeat(40), "123"), /ENOENT/);
  }));
test("wrong trace status rejected", () =>
  temporary((root) => {
    const png = Buffer.from("unit fixture"),
      trace = Buffer.from(
        JSON.stringify({
          method: "PUT",
          path: "/computers/vm-" + "a".repeat(32) + "/media/boot",
          actor: "foreign",
          status: 202,
          expected: 404,
        }),
      );
    writeFileSync(join(root, "imported-disk-direct-display.png"), png);
    writeFileSync(join(root, "media-direct-http.jsonl"), trace);
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    writeFileSync(
      join(root, "media-direct-verification.json"),
      JSON.stringify({ ...proof, screenshotSha256: sha(png), traceSha256: sha(trace) }),
    );
    assert.throws(
      () => verifyMedia(root, "a".repeat(40), "123", () => "cirroslogin"),
      /Failed or invalid HTTP trace/,
    );
  }));
