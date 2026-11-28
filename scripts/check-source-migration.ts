/** Fail closed on repository-owned legacy tooling; external OCI registry names are not CLIs. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isMain } from "./tooling.ts";
const forbiddenDependency = (name: string) =>
  /^(?:vinext|vite(?:$|-)|vitest(?:$|-)|@vitejs\/|@vitest\/|@vinext\/|@voidzero-dev\/vite|react-server-dom-webpack$)/.test(name);
export function migrationViolations(path: string, content: string) {
  const errors: string[] = [];
  if (
    /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|\.dockerignore|docker-compose(?:\.[^/]*)?|compose\.ya?ml|__pycache__)(?:$|\/)|\.(?:py|pyc|pyo)$/i.test(
      path,
    )
  )
    errors.push("legacy tracked file");
  if (/(?:^|\/)vite\.config\.[^/]+$/.test(path)) errors.push("removed framework configuration");
  if (path === "package.json") {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
      if (forbiddenDependency(name)) errors.push("removed framework dependency: " + name);
    for (const command of Object.values(pkg.scripts ?? {}))
      if (/(?:^|[;&|]\s*)(?:vp|vite|vinext|vitest)(?:\s|$)/.test(command))
        errors.push("removed framework command: " + command);
  }
  if (path === "package-lock.json") {
    const lock = JSON.parse(content) as { packages?: Record<string, unknown> };
    for (const name of Object.keys(lock.packages ?? {})) {
      const pkg = name.split("node_modules/").at(-1) ?? "";
      if (forbiddenDependency(pkg)) errors.push("removed installed dependency: " + name);
    }
  }
  if (
    !/^(?:scripts\/|tests\/|src\/|app\/|infra\/|showcases\/|\.github\/workflows\/|package\.json$)/.test(
      path,
    ) ||
    !/\.(?:ts|tsx|sh|ps1|json|ya?ml|m?js)$/.test(path)
  )
    return errors;
  if (path === "scripts/check-source-migration.ts" || path === "tests/source-migration.test.ts")
    return errors;
  const checks: [RegExp, string][] = [
    [/\b(?:vite-plus\/register|vite-plus\/test)\b|\bfrom\s+["\x27](?:vinext|vite|vitest)["\x27]/, "removed framework loader or test runner"],
    [
      /(?:^|[;&|]\s*)[ \t]*(?:sudo[ \t]+)?(?:[^\s;|&]+\/)?python(?:2|3(?:\.\d+)?)?(?=[ \t\r\n;&|]|$)/im,
      "shell interpreter command",
    ],
    [
      /\b(?:execFile(?:Sync)?|spawn(?:Sync)?|execa(?:Sync)?)\s*\(\s*["'\x60](?:[^"'\x60\n]+\/)?python(?:2|3(?:\.\d+)?)?["'\x60]/i,
      "programmatic interpreter command",
    ],
    [
      /\b(?:execFile(?:Sync)?|spawn(?:Sync)?|execa(?:Sync)?)\s*\(\s*["'\x60](?:[^"'\x60\n]+\/)?docker["'\x60]/i,
      "programmatic daemon command",
    ],
    [
      /\b(?:apt(?:-get)?|dnf|yum|apk)\s+[^\r\n;|&]*\b(?:install|add)\s+[^\r\n;|&]*\bpython(?:2|3(?:\.\d+)?)?(?=[\s;|&"'\\]|$)/i,
      "explicit interpreter package dependency",
    ],
    [
      /\bpython(?:2|3(?:\.\d+)?)?\s+(?:-\w|[^\s"'\x60]+\.py\b)|\b(?:setup-python|python-version)\b|#![^\n]*\bpython[23]?\b/i,
      "interpreter invocation or CI dependency",
    ],
    [
      /\b(?:sudo\s+)?docker\s+(?:buildx|build|run|compose|pull|push|load|save|exec|inspect|system|image|container|network|volume|login|version|info|ps|rm|rmi|tag|start|stop)\b|\bdocker-compose\b|\/var\/run\/docker\.sock|\bDOCKER_HOST\b|\b(?:docker\/setup-buildx-action|docker\/build-push-action|docker\/login-action)\b/i,
      "daemon-specific tooling",
    ],
    [/\b(?:scripts|showcases)\/[^\s"'\x60]+\.py\b/i, "legacy script reference"],
  ];
  for (const [pattern, reason] of checks) if (pattern.test(content)) errors.push(reason);
  return errors;
}
if (isMain(import.meta.url)) {
  const paths = execFileSync("git", ["ls-files", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const errors = paths.flatMap((path) =>
    migrationViolations(path, readFileSync(path, "utf8")).map((reason) => path + ": " + reason),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Verified tracked source migration: " +
      paths.length +
      " files, no legacy interpreter or daemon-specific tooling.",
  );
}
