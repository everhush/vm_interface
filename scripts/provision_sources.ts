import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arch } from "node:os";
import { parseArgs } from "node:util";
import { fileSha256, isMain } from "./tooling.ts";
export const COMMON = new Set([
  "install.sh",
  "kubevirt-operator.yaml",
  "kubevirt-cr.yaml",
  "cdi-operator.yaml",
  "cdi-cr.yaml",
  "cnpg.yaml",
]);
export const ARCH: Record<string, string> = { x86_64: "k3s-amd64", aarch64: "k3s-arm64" };
type Asset = { name: string; url: string; bytes: number; sha256: string; architecture: string };
type Manifest = { version: number; assets: Asset[] };
export function load(manifest: Manifest, architecture: string): Asset[] {
  if (!Object.hasOwn(ARCH, architecture) || manifest.version !== 1)
    throw Error("Unsupported manifest or architecture");
  const seen = new Set<string>(),
    selected: Asset[] = [];
  for (const row of manifest.assets) {
    const u = new URL(row.url);
    if (
      seen.has(row.name) ||
      (!COMMON.has(row.name) && !Object.values(ARCH).includes(row.name)) ||
      u.protocol !== "https:" ||
      !["github.com", "raw.githubusercontent.com"].includes(u.host) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !/^[0-9a-f]{64}$/.test(row.sha256) ||
      !Number.isInteger(row.bytes) ||
      row.bytes <= 0 ||
      row.bytes > 100 * 1024 * 1024 ||
      !["all", ...Object.keys(ARCH)].includes(row.architecture)
    )
      throw Error("Invalid provisioning asset: " + row.name);
    seen.add(row.name);
    if (row.architecture === "all" || row.architecture === architecture) selected.push(row);
  }
  const required = new Set([...COMMON, ARCH[architecture]]);
  if (selected.length !== required.size || selected.some((r) => !required.has(r.name)))
    throw Error("Incomplete architecture provisioning manifest");
  return selected;
}
export function verify(path: string, row: Pick<Asset, "name" | "bytes" | "sha256">) {
  if (statSync(path).size !== row.bytes) throw Error("Wrong asset size: " + row.name);
  if (fileSha256(path) !== row.sha256) throw Error("Wrong asset digest: " + row.name);
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: { directory: { type: "string" }, evidence: { type: "string" } },
    strict: true,
  });
  if (!values.directory || !values.evidence) throw Error("Directory and evidence required");
  const architecture = arch() === "x64" ? "x86_64" : arch() === "arm64" ? "aarch64" : arch();
  const rows = load(
    JSON.parse(readFileSync(new URL("../infra/provision-sources.json", import.meta.url), "utf8")),
    architecture,
  );
  for (const row of rows) {
    const target = join(values.directory, row.name);
    if (existsSync(target)) throw Error("Refusing to overwrite existing provisioning input");
    execFileSync(
      "curl",
      [
        "--fail",
        "--location",
        "--retry",
        "3",
        "--max-time",
        "300",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-filesize",
        String(row.bytes),
        "--output",
        target,
        row.url,
      ],
      { stdio: "inherit", timeout: 310000 },
    );
    verify(target, row);
  }
  writeFileSync(
    values.evidence,
    JSON.stringify({ architecture, assets: rows, allBytesVerified: true }, null, 2) + "\n",
  );
}
