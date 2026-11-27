/** Shared exact-input validation for native showcase and offline preparation. */
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { fileSha256, isMain } from "./tooling.ts";
import { loadScenario, WINDOWS_RESULT, type Profile } from "./showcase-inputs.ts";
import { ZipReader } from "./zip-reader.ts";
const options = {
  media: { type: "string" },
  "media-sha256": { type: "string" },
  "auxiliary-media": { type: "string" },
  "auxiliary-sha256": { type: "string" },
  "auxiliary-gib": { type: "string" },
  source: { type: "string" },
  version: { type: "string" },
  software: { type: "string" },
  "software-sha256": { type: "string" },
  scenario: { type: "string" },
  "system-gib": { type: "string", default: "40" },
  "authorize-media": { type: "boolean" },
  "record-consent": { type: "boolean" },
  retain: { type: "boolean" },
  "exchange-drive": { type: "string", default: "X:" },
  "preflight-only": { type: "boolean" },
  "android-transfer": { type: "string", default: "virtiofs-saf" },
  "authorize-android-debug": { type: "boolean" },
} as const;
export function parseShowcase(argv: string[]) {
  const { values: v, positionals } = parseArgs({
    args: argv,
    options,
    allowPositionals: true,
    strict: true,
  });
  const profile = positionals[0];
  assert(
    positionals.length === 1 && (profile === "windows" || profile === "android"),
    "Invalid showcase profile",
  );
  const required = (x: string | undefined) => {
    assert(x, "Missing required showcase input");
    return x;
  };
  const numeric = (x: string | undefined) => {
    assert(x && /^\d+$/.test(x) && Number.isSafeInteger(Number(x)), "Invalid capacity");
    return Number(x);
  };
  assert(
    v["authorize-media"] && v["record-consent"],
    "Explicit media authorization and recording consent required",
  );
  const transfer = v["android-transfer"];
  assert(transfer === "virtiofs-saf" || transfer === "adb-saf", "Invalid transfer mode");
  const adbMode = transfer === "adb-saf";
  assert(
    adbMode === Boolean(v["authorize-android-debug"]) && (!adbMode || profile === "android"),
    "Explicit Android-only authenticated debug authorization is required for adb-saf",
  );
  return {
    profile: profile as Profile,
    media: required(v.media),
    mediaSha256: required(v["media-sha256"]),
    auxiliaryMedia: v["auxiliary-media"],
    auxiliarySha256: v["auxiliary-sha256"],
    auxiliaryGiB: v["auxiliary-gib"] === undefined ? undefined : numeric(v["auxiliary-gib"]),
    source: required(v.source),
    version: required(v.version),
    software: required(v.software),
    softwareSha256: required(v["software-sha256"]),
    scenario: required(v.scenario),
    systemGiB: numeric(v["system-gib"]),
    exchangeDrive: required(v["exchange-drive"]),
    retain: Boolean(v.retain),
    preflightOnly: Boolean(v["preflight-only"]),
    transfer,
    adbMode,
  };
}
export type ShowcaseArgs = ReturnType<typeof parseShowcase>;
function verifyLocal(path: string, expected: string, limit: number) {
  const s = statSync(path);
  assert(s.isFile() && s.size > 0 && s.size <= limit, "Local input size exceeds bound");
  assert(
    /^[a-f0-9]{64}$/.test(expected) && fileSha256(path) === expected,
    "Local media checksum mismatch",
  );
}
export function validateShowcase(args: ShowcaseArgs) {
  const scenario = loadScenario(args.scenario, args.profile),
    win = args.profile === "windows",
    ext = (p: string) => extname(p).toLowerCase();
  verifyLocal(args.media, args.mediaSha256, 8 * 1024 ** 3);
  verifyLocal(args.software, args.softwareSha256, 8 * 1024 ** 2);
  if (win) {
    assert(
      ext(args.media) === ".iso" &&
        ext(args.software) === ".exe" &&
        args.systemGiB >= 32 &&
        /^[A-Za-z]:$/.test(args.exchangeDrive) &&
        scenario.expectedResultSha256 === WINDOWS_RESULT,
      "Invalid Windows media or scenario",
    );
  } else {
    assert(
      [".raw", ".img", ".qcow2"].includes(ext(args.media)) && ext(args.software) === ".apk",
      "Invalid Android media",
    );
    const apk = new ZipReader(args.software, 4096);
    try {
      assert(
        ["AndroidManifest.xml", "classes.dex"].every(
          (n) => apk.entries.filter((e) => e.name === n).length === 1,
        ),
        "Missing or duplicate APK entries",
      );
    } finally {
      apk.close();
    }
  }
  if (args.auxiliaryMedia) {
    assert(
      ext(args.auxiliaryMedia) === (win ? ".iso" : ".qcow2") &&
        args.auxiliaryGiB !== undefined &&
        args.auxiliaryGiB >= 1 &&
        args.auxiliaryGiB <= 64 &&
        args.auxiliarySha256,
      "Invalid auxiliary media",
    );
    verifyLocal(args.auxiliaryMedia, args.auxiliarySha256, 8 * 1024 ** 3);
  } else
    assert(
      !args.auxiliarySha256 && args.auxiliaryGiB === undefined && !win,
      "Windows driver bootstrap requires separately verified auxiliary ISO",
    );
  return scenario;
}
export function preflight(args: ShowcaseArgs) {
  validateShowcase(args);
  return {
    profile: args.profile,
    localInputsVerified: true,
    guestCompatibilityVerified: false,
    transferPath: args.transfer,
    mediaSha256: args.mediaSha256,
    softwareSha256: args.softwareSha256,
    scenarioSha256: fileSha256(args.scenario),
  };
}
if (isMain(import.meta.url)) {
  const args = parseShowcase(process.argv.slice(2));
  assert(args.preflightOnly, "This entry point is offline preflight only");
  console.log(JSON.stringify(preflight(args)));
}
