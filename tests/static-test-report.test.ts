import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { verifyStaticReport, MINIMUM_TESTS } from "../scripts/verify-static-test-report.ts";

function report() {
  return {
    success: true,
    numTotalTests: MINIMUM_TESTS,
    numPassedTests: MINIMUM_TESTS,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: "/tmp/a.test.ts",
        assertionResults: Array.from({ length: MINIMUM_TESTS }, () => ({ status: "passed" })),
      },
    ],
  };
}
test("accept only complete matching test reports", () => {
  assert.deepEqual(verifyStaticReport(report(), ["a.test.ts"]), {
    files: 1,
    passed: MINIMUM_TESTS,
  });
  assert.throws(
    () => verifyStaticReport(report(), ["a.test.ts", "b.test.ts"]),
    /Missing or duplicated/,
  );
});
test("reject reduced, skipped or inconsistent evidence", () => {
  assert.throws(
    () => verifyStaticReport({ ...report(), numTotalTests: MINIMUM_TESTS - 1 }, ["a.test.ts"]),
    /baseline/,
  );
  assert.throws(
    () => verifyStaticReport({ ...report(), numPendingTests: 1 }, ["a.test.ts"]),
    /Pending/,
  );
  assert.throws(() => verifyStaticReport({ ...report(), numTodoTests: 1 }, ["a.test.ts"]), /Todo/);
  const r = report();
  r.testResults[0].assertionResults[0].status = "skipped";
  assert.throws(() => verifyStaticReport(r, ["a.test.ts"]), /Non-passing/);
  const short = report();
  short.testResults[0].assertionResults.pop();
  assert.throws(() => verifyStaticReport(short, ["a.test.ts"]), /count mismatch/);
});
