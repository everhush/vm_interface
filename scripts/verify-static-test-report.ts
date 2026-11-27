import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { isMain } from "./tooling.ts";

// Preserve the 155 existing tests plus three migration regressions; additions may increase it.
export const MINIMUM_TESTS = 158;
type Report = {
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults?: { name: string; assertionResults?: { status: string }[] }[];
};
export function verifyStaticReport(report: Report, expectedFiles: string[]) {
  assert.equal(report.success, true, "Test runner did not report success");
  assert(
    Number.isSafeInteger(report.numTotalTests) && report.numTotalTests! >= MINIMUM_TESTS,
    "Test count fell below qualified baseline",
  );
  assert.equal(report.numPassedTests, report.numTotalTests, "Every discovered test must pass");
  assert.equal(report.numFailedTests, 0, "Failed tests");
  assert.equal(report.numPendingTests, 0, "Pending or skipped tests");
  assert.equal(report.numTodoTests, 0, "Todo tests");
  assert(Array.isArray(report.testResults), "Missing per-file test results");
  assert.deepEqual(
    report.testResults.map((file) => basename(file.name)).sort(),
    [...expectedFiles].sort(),
    "Missing or duplicated test file",
  );
  let passed = 0;
  for (const file of report.testResults) {
    assert(
      Array.isArray(file.assertionResults) && file.assertionResults.length > 0,
      "Empty test file: " + file.name,
    );
    for (const result of file.assertionResults) {
      assert.equal(result.status, "passed", "Non-passing assertion in " + file.name);
      passed++;
    }
  }
  assert.equal(passed, report.numTotalTests, "Per-test result count mismatch");
  return { files: expectedFiles.length, passed };
}
if (isMain(import.meta.url)) {
  assert.equal(
    process.argv.length,
    3,
    "Usage: node scripts/verify-static-test-report.ts REPORT.json",
  );
  const expectedFiles = readdirSync(new URL("../tests/", import.meta.url)).filter((name) =>
    name.endsWith(".test.ts"),
  );
  assert(expectedFiles.length >= 59, "Test file count fell below migration baseline");
  const report = JSON.parse(readFileSync(process.argv[2], "utf8")) as Report;
  console.log(JSON.stringify(verifyStaticReport(report, expectedFiles)));
}
