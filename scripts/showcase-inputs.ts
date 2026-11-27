/** Offline fail-closed scenario validation. A preflight pass is not guest compatibility. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { strictJson } from "./strict-json.ts";
import { ANDROID_RESULT_MODE } from "./android-fixture.ts";
export type Profile = "windows" | "android";
export type Checkpoint = { text: string; seconds: number };
export type Step =
  | { wait: Checkpoint }
  | { delay: number }
  | { text: string }
  | { keys: number[] }
  | { "click-label": Checkpoint }
  | { click: [number, number] }
  | { human: string }
  | { "system-boot": true };
export type Scenario = {
  setup: Step[];
  softwareSetup: Step[];
  application: Step[];
  beforeMarker: string;
  afterMarker: string;
  resultName: string;
  expectedResultSha256: string;
};
export const WINDOWS_RESULT = createHash("sha256")
  .update("VM Interface Windows 7-Zip functional proof\n")
  .digest("hex");
export function normalize(value: unknown) {
  assert(typeof value === "string", "Screen marker must be a string");
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: string[]) =>
  Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
function checkpoint(v: unknown, chars: number, seconds: number): v is Checkpoint {
  if (!record(v) || !exact(v, ["text", "seconds"])) return false;
  const n = normalize(v.text).length;
  return n >= 1 && n <= chars && integer(v.seconds, 1, seconds);
}
export function validateSteps(items: unknown, profile: Profile, recording: boolean) {
  assert(
    Array.isArray(items) && items.length >= 1 && items.length <= 100,
    "Each scenario phase needs 1–100 steps",
  );
  let budget = 0;
  const actions = new Set<string>();
  for (const step of items) {
    assert(
      record(step) && Object.keys(step).length === 1,
      "Each step must specify exactly one action",
    );
    const [kind, v] = Object.entries(step)[0];
    actions.add(kind);
    switch (kind) {
      case "wait":
        assert(checkpoint(v, 100, 900), "Invalid visible checkpoint");
        budget += v.seconds;
        break;
      case "delay":
        assert(integer(v, 0, 60), "Invalid delay");
        budget += v;
        break;
      case "text":
        assert(
          typeof v === "string" && v.length >= 1 && v.length <= 4096 && /^[\x20-\x7e]+$/.test(v),
          "Invalid keyboard text",
        );
        break;
      case "keys":
        assert(
          Array.isArray(v) &&
            v.length >= 1 &&
            v.length <= 8 &&
            v.every((k) => integer(k, 0, 0x1fffffff)),
          "Invalid keyboard keys",
        );
        break;
      case "click-label":
        assert(checkpoint(v, 60, 60), "Invalid visible button target");
        budget += v.seconds;
        break;
      case "click":
        assert(
          Array.isArray(v) && v.length === 2 && integer(v[0], 0, 1919) && integer(v[1], 0, 1199),
          "Invalid pointer coordinates",
        );
        break;
      case "human":
        assert(
          !recording && typeof v === "string" && v.length >= 1 && v.length <= 160,
          "Human authorization checkpoints must be outside recording",
        );
        break;
      case "system-boot":
        assert(
          !recording && profile === "windows" && v === true,
          "System boot only permitted in Windows setup",
        );
        break;
      default:
        throw Error("Unsupported scenario action");
    }
  }
  assert(
    !recording || budget <= 65,
    "Recorded scenario wait/delay budget exceeds 65 seconds; reserve time for API input and final evidence",
  );
  return actions;
}
export function loadScenario(path: string, profile: Profile): Scenario {
  assert(profile === "windows" || profile === "android", "Invalid profile");
  const stat = statSync(path);
  assert(stat.isFile() && stat.size <= 256 * 1024, "Invalid scenario file");
  const scenario = strictJson(readFileSync(path, "utf8"));
  assert(
    record(scenario) &&
      exact(scenario, [
        "setup",
        "softwareSetup",
        "application",
        "beforeMarker",
        "afterMarker",
        "resultName",
        "expectedResultSha256",
      ]),
    "Invalid scenario fields",
  );
  const before = normalize(scenario.beforeMarker),
    after = normalize(scenario.afterMarker);
  assert(
    before.length >= 1 &&
      before.length <= 100 &&
      after.length >= 1 &&
      after.length <= 100 &&
      before !== after,
    "Distinct visible before/after checkpoints required",
  );
  assert(scenario.resultName === "result.txt", "Expected fixture output result.txt");
  assert(
    scenario.expectedResultSha256 ===
      (profile === "windows" ? WINDOWS_RESULT : ANDROID_RESULT_MODE),
    "Unexpected fixture result digest",
  );
  const setup = validateSteps(scenario.setup, profile, false);
  assert(Array.isArray(scenario.softwareSetup), "Invalid software preparation");
  if (scenario.softwareSetup.length) validateSteps(scenario.softwareSetup, profile, false);
  assert(
    profile !== "android" || scenario.softwareSetup.length > 0,
    "Android needs post-upload authorized installation and directory selection",
  );
  const application = validateSteps(scenario.application, profile, true);
  if (profile === "windows")
    assert(
      setup.has("system-boot") && (after.includes("7zip") || after.includes("proof7z")),
      "Windows requires installer-to-system boot and real 7-Zip checkpoint",
    );
  else
    assert(
      after.includes("apkcompletearm64v8a") &&
        ["keys", "click", "click-label", "text"].some((k) => application.has(k)),
      "Android requires native ABI checkpoint and actual application input",
    );
  return scenario as unknown as Scenario;
}
