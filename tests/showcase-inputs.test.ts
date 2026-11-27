import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { androidResult } from "../scripts/android-fixture.ts";
import { loadScenario, type Profile } from "../scripts/showcase-inputs.ts";
import { generateScenario } from "../scripts/write-showcase-scenario.ts";
import { strictJson } from "../scripts/strict-json.ts";
function check(profile: Profile, scenario: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "scenario-"));
  try {
    const p = join(dir, "scenario.json");
    writeFileSync(p, JSON.stringify(scenario));
    return JSON.parse(JSON.stringify(loadScenario(p, profile)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("generated Windows and both Android scenarios pass exact validation", () => {
  for (const [profile, transfer] of [
    ["windows", "virtiofs-saf"],
    ["android", "virtiofs-saf"],
    ["android", "adb-saf"],
  ] as const) {
    const s = generateScenario(profile, transfer);
    assert.deepEqual(check(profile, s), s);
  }
});
test("reject unsafe or incomplete recorded actions", () => {
  for (const application of [
    [{ human: "password" }],
    [{ delay: 60 }, { wait: { text: "Done", seconds: 60 } }],
    [{ click: [true, 2] }],
    [],
    [{ unknown: 1 }],
  ])
    assert.throws(() => check("android", { ...generateScenario("android"), application }));
});
test("reject incorrect native profile and fixture digest", () => {
  assert.throws(() => check("windows", { ...generateScenario("windows"), setup: [{ delay: 1 }] }));
  assert.throws(() =>
    check("android", { ...generateScenario("android"), expectedResultSha256: "0".repeat(64) }),
  );
});
test("Android output bound to actual 4096 byte challenge", () => {
  const a = Buffer.alloc(4096),
    b = Buffer.alloc(4096, 1);
  assert.notDeepEqual(androidResult(a), androidResult(b));
  assert(androidResult(a).includes(createHash("sha256").update(a).digest("hex")));
  assert.throws(() => androidResult(a.subarray(1)));
});
test("JSON rejects duplicate decoded keys and malformed input", () => {
  for (const s of [
    '{"x":1,"x":2}',
    '{"x":1,"\\u0078":2}',
    '[{"x":1,"x":2}]',
    '{"x":1,}',
    "[1,]",
    "01",
    '{"x":1} trailing',
  ])
    assert.throws(() => strictJson(s));
  assert.equal(
    JSON.stringify(strictJson('{"x":[1,true,null,{"__proto__":"ok"}]}')),
    '{"x":[1,true,null,{"__proto__":"ok"}]}',
  );
});
