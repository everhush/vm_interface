import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const isMain = (url: string) =>
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === url;
export function fileSha256(path: string): string {
  const h = createHash("sha256"),
    fd = openSync(path, "r"),
    buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (!n) break;
      h.update(buffer.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}
