import { execFileSync } from "node:child_process";
import { readFileSync, statSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { fileSha256, isMain } from "./tooling.ts";
type Source = { name: string; url: string; sha256: string; bytes?: number };
export function fetchPinned(key: string, directory: string): string {
  const sources: Record<string, Source> = JSON.parse(
    readFileSync(new URL("../showcases/media-sources.json", import.meta.url), "utf8"),
  );
  if (
    !["android", "winfsp", "virtio", "software", "virtioISO"].includes(key) ||
    !Object.hasOwn(sources, key)
  )
    throw Error("Unknown media source");
  const spec = sources[key],
    limit = spec.bytes ?? 256 * 1024 ** 2;
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    basename(spec.name) !== spec.name ||
    !/^[a-f0-9]{64}$/.test(spec.sha256) ||
    new URL(spec.url).protocol !== "https:"
  )
    throw Error("Invalid pinned media");
  mkdirSync(directory, { recursive: true });
  const target = join(directory, spec.name);
  if (lstatSync(target, { throwIfNoEntry: false })) throw Error("Refusing to overwrite media");
  try {
    execFileSync(
      process.platform === "win32" ? "curl.exe" : "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--connect-timeout",
        "30",
        "--max-time",
        "600",
        "--max-filesize",
        String(limit),
        "--output",
        target,
        spec.url,
      ],
      { timeout: 630000, stdio: ["ignore", "ignore", "inherit"] },
    );
    const size = statSync(target).size;
    if (size > limit || (spec.bytes !== undefined && size !== limit))
      throw Error("Source length differs from pinned bound");
    if (fileSha256(target) !== spec.sha256)
      throw Error("Source digest differs from pinned manifest");
    return target;
  } catch (e) {
    try {
      unlinkSync(target);
    } catch {
      /* no file created */
    }
    throw e;
  }
}
if (isMain(import.meta.url)) {
  if (process.argv.length !== 4) throw Error("Source and directory required");
  console.log(fetchPinned(process.argv[2], process.argv[3]));
}
