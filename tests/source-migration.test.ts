import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationViolations } from "../scripts/check-source-migration.ts";
test("reject tracked legacy scripts and build configs", () => {
  for (const path of [
    "scripts/a.py",
    "scripts/__pycache__/a.pyc",
    "Dockerfile",
    "build/Dockerfile.test",
    ".dockerignore",
    "docker-compose.yml",
  ])
    assert(migrationViolations(path, "").length, path);
});
test("reject executable interpreter or daemon references", () => {
  for (const value of [
    "python3 -c 'print(1)'",
    "python3 scripts/test.py",
    "uses: actions/setup-python@v5",
    "sudo docker run hello",
    "/var/run/docker.sock",
    "docker/build-push-action@v6",
  ])
    assert(migrationViolations("scripts/check.sh", value).length, value);
});
test("permit OCI interoperability and historical documentation", () => {
  assert.deepEqual(
    migrationViolations("scripts/build-oci.sh", "buildah from docker.io/library/node:24"),
    [],
  );
  assert.deepEqual(
    migrationViolations("docs/implementation.md", "historical Python 3 test count"),
    [],
  );
});

test("inspect tests and reject indirect executable invocation", () => {
  for (const value of [
    "spawn('python3',['-c','pass'])",
    "execFileSync('/usr/bin/python3',args)",
    "spawnSync('docker',['build','.'])",
    'python3 "$fixture"',
    "apt-get install -y python3",
  ])
    assert(migrationViolations("tests/fixture.test.ts", value).length, value);
  assert.deepEqual(
    migrationViolations("tests/fixture.test.ts", "const url='https://docker.io/library/node'"),
    [],
  );
});

test("reject removed framework configuration, dependencies and executable paths", () => {
  assert(migrationViolations("vite.config.ts", "").length);
  for (const name of ["vinext", "vite", "vite-plus", "vitest", "@vitejs/plugin-react", "@voidzero-dev/vite-plus-core", "react-server-dom-webpack"])
    assert(migrationViolations("package.json", JSON.stringify({ dependencies: { [name]: "1" } })).length, name);
  assert(migrationViolations("package.json", JSON.stringify({ scripts: { build: "vp build" } })).length);
  assert(migrationViolations("infra/app.yaml", 'command: ["node","--import","vite-plus/register","src/run.ts"]').length);
  assert(migrationViolations("tests/example.test.ts", 'import { test } from "vite-plus/test"').length);
  assert(migrationViolations("package-lock.json", JSON.stringify({ packages: { "node_modules/next/node_modules/vite": { version: "8" } } })).length);
  assert.deepEqual(migrationViolations("package.json", JSON.stringify({ dependencies: { next: "16", tsx: "4" }, scripts: { build: "next build", test: "node --import tsx scripts/run-static-tests.ts" } })), []);
  assert.deepEqual(migrationViolations("scripts/run.sh", "node --import tsx src/run.ts"), []);
  assert.deepEqual(migrationViolations("tests/example.test.ts", 'import { test } from "node:test"'), []);
});
