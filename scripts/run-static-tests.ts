import { run } from "node:test";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const files = readdirSync("tests").filter((file) => file.endsWith(".test.ts")).sort()
  .map((file) => resolve("tests", file));
const results = new Map(files.map((file) => [file, {
  name: file,
  assertionResults: [] as { title: string; status: string }[],
}]));
let failed = false;
for await (const event of run({ files, concurrency: false, timeout: 60000, execArgv: ["--import", "tsx"] })) {
  if (event.type === "test:pass" || event.type === "test:fail") {
    const data = event.data;
    const status = "todo" in data && data.todo ? "todo" : "skip" in data && data.skip ? "skipped" : event.type === "test:pass" ? "passed" : "failed";
    const file = data.file && results.get(resolve(data.file));
    if (!file) { failed = true; console.error("Unattributed test", data.name); continue; }
    file.assertionResults.push({ title: data.name, status });
    if (status !== "passed") { failed = true; console.error(status, data.name, data.details); }
    else console.log("PASS", data.name);
  } else if (event.type === "test:summary" && !event.data.success) {
    failed = true;
  } else if (event.type === "test:stderr") {
    process.stderr.write(event.data.message);
  }
}
const testResults = [...results.values()];
const assertions = testResults.flatMap((file) => file.assertionResults);
const count = (status: string) => assertions.filter((test) => test.status === status).length;
const report = {
  success: !failed && testResults.every((file) => file.assertionResults.length > 0),
  numTotalTests: assertions.length,
  numPassedTests: count("passed"),
  numFailedTests: count("failed"),
  numPendingTests: count("skipped"),
  numTodoTests: count("todo"),
  testResults,
};
const output = process.argv.find((arg) => arg.startsWith("--outputFile="))?.slice("--outputFile=".length);
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, testResults: undefined }));
if (!report.success) process.exitCode = 1;
