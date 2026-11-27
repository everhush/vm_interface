/** Independently check exact-candidate retained media evidence (no hardware claim). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ocr } from "./evidence-frames.ts";
import { fileSha256, isMain } from "./tooling.ts";
import assert from "node:assert/strict";
const MODES = ["direct", "resumable", "dual", "url"] as const;
export const PUBLIC_SHA = "7d6355852aeb6dbcd191bcda7cd74f1536cfe5cbf8a10495a7283a8396e4b75b",
  PUBLIC_BYTES = 21692416;
export const OCI_SHA = "a8dd75ecffd4cdd96072d60c2237b448e0c8b2bc94d57f10fdbc8c481d9005b8",
  OCI_BYTES = 12716032;
type Trace = {
  method: string;
  path: string;
  actor: string;
  status: number;
  expected: number;
  bodyBytes?: number;
  bodySha256?: string;
};
export function verifyMedia(root: string, commit: string, runId: string, screenOcr = ocr) {
  assert(/^[a-f0-9]{40}$/.test(commit), "Invalid exact commit");
  assert(/^(?:[0-9]+|device-[0-9]{8}T[0-9]{6}Z-[0-9]+)$/.test(runId), "Invalid execution identity");
  const read = (name: string) =>
    JSON.parse(readFileSync(join(root, name), "utf8")) as Record<string, unknown>;
  const rowsByMode: Record<string, number> = {};
  for (const mode of MODES) {
    const proof = read("media-" + mode + "-verification.json"),
      [digest, count] = mode === "url" ? [PUBLIC_SHA, PUBLIC_BYTES] : [OCI_SHA, OCI_BYTES];
    assert(
      proof.commit === commit && proof.runId === runId && proof.mode === mode,
      "Wrong media execution",
    );
    assert(proof.sha256 === digest && proof.bytes === count, "Image pin mismatch");
    assert(
      [
        "verifiedCDI",
        "badDigestDenied",
        "crossAccountDenied",
        "idempotent",
        "guestLoginVerified",
      ].every((k) => proof[k] === true),
      "Incomplete native media proof",
    );
    const screenshot = join(root, "imported-disk-" + mode + "-display.png");
    assert(
      fileSha256(screenshot) === proof.screenshotSha256 &&
        screenOcr(screenshot).includes("cirroslogin"),
      "Missing original guest login",
    );
    const trace = join(root, "media-" + mode + "-http.jsonl");
    assert(fileSha256(trace) === proof.traceSha256, "Media HTTP trace checksum mismatch");
    const rows = readFileSync(trace, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((x) => JSON.parse(x) as Trace);
    assert(
      rows.length &&
        rows.every(
          (x) =>
            Object.keys(x).every((k) =>
              ["method", "path", "actor", "expected", "status", "bodyBytes", "bodySha256"].includes(
                k,
              ),
            ) && x.status === x.expected,
        ),
      "Failed or invalid HTTP trace",
    );
    const found = (method: string, pattern: string, actor: string, status: number, body?: number) =>
      rows.some(
        (x) =>
          x.method === method &&
          new RegExp("^" + pattern + "$").test(x.path) &&
          x.actor === actor &&
          x.status === status &&
          (body === undefined || x.bodyBytes === body),
      );
    const vm = "/computers/vm-[a-f0-9]{32}",
      boot = vm + "/media/boot";
    assert(
      found("POST", vm + "/start", "owner", 202) &&
        found("GET", vm + "/screenshot", "owner", 200) &&
        found("DELETE", vm + "\\?deleteDisks=true", "owner", 202),
      "Missing real boot or cleanup calls",
    );
    assert(
      found("GET", vm + "/media", "foreign", 404) && found("PUT", boot, "foreign", 404, count),
      "Missing full-size cross-account denial",
    );
    if (mode === "direct" || mode === "dual")
      assert(
        found("PUT", boot, "owner", 422, count) && found("PUT", boot, "owner", 202, count),
        "Missing actual digest rejection or import",
      );
    if (mode === "resumable")
      assert(
        found("PUT", boot + "/chunks", "foreign", 404, 8 * 1024 * 1024) &&
          found("PUT", boot + "/chunks", "owner", 422, 8 * 1024 * 1024) &&
          found("POST", boot + "/commit", "owner", 202),
        "Missing resumable proof",
      );
    if (mode === "dual")
      assert(
        found("PUT", vm + "/media/auxiliary", "owner", 202),
        "Missing independent auxiliary import",
      );
    if (mode === "url") {
      const art = "/media-artifacts/[a-f0-9-]{36}";
      assert(
        found("POST", "/media-artifacts", "owner", 202) &&
          found("PUT", art + "/file", "foreign", 404, count) &&
          found("PUT", art + "/file", "owner", 422, count) &&
          found("PUT", art + "/file", "owner", 409, count) &&
          found("PUT", art + "/file", "owner", 202, count) &&
          found("POST", boot + "/artifact", "foreign", 404) &&
          found("DELETE", art, "owner", 202),
        "Missing registered-image authorization, integrity or immutability proof",
      );
      const imports = new Set(
        rows
          .filter(
            (x) =>
              x.method === "POST" &&
              x.status === 202 &&
              new RegExp("^" + boot + "/artifact$").test(x.path),
          )
          .map((x) => x.path),
      );
      assert(imports.size === 2, "Missing two independent registered-image imports");
    }
    rowsByMode[mode] = rows.length;
  }
  for (const [name, cacheHit] of [
    ["acquisition", false],
    ["cache", true],
  ] as const) {
    assert.deepEqual(
      read("public-image-" + name + ".json"),
      {
        authorizedByClient: true,
        bytes: PUBLIC_BYTES,
        sha256: PUBLIC_SHA,
        sourceHost: "download.cirros-cloud.net",
        cacheHit,
      },
      "Public source/cache pin mismatch",
    );
  }
  const artifact = read("registered-artifact-verification.json");
  assert(
    artifact.sha256 === PUBLIC_SHA && artifact.bytes === PUBLIC_BYTES,
    "Registered source pin mismatch",
  );
  assert(
    ["artifactId", "sourcePvcUid", "copyPvcUid"].every(
      (k) => typeof artifact[k] === "string" && /^[a-f0-9-]{36}$/.test(artifact[k] as string),
    ) && artifact.sourcePvcUid !== artifact.copyPvcUid,
    "Missing independent CDI identities",
  );
  assert(
    ["crossAccountDenied", "badDigestDenied", "immutable", "deletedArtifactIndependentDisks"].every(
      (k) => artifact[k] === true,
    ),
    "Incomplete registered artifact proof",
  );
  return {
    commit,
    runId,
    httpCallsByMode: rowsByMode,
    verifiedMediaModes: [...MODES],
    hardwareCertifiedByVerifier: false,
  };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: { root: { type: "string" }, commit: { type: "string" }, "run-id": { type: "string" } },
  });
  if (!values.root || !values.commit || !values["run-id"])
    throw Error("--root, --commit, --run-id required");
  console.log(JSON.stringify(verifyMedia(values.root, values.commit, values["run-id"]), null, 2));
}
