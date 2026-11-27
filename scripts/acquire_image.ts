/** Authorized client-side acquisition: HTTPS only, checked DNS, pinned TCP, no ambient proxy. */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createReadStream,
  closeSync,
  fstatSync,
  fsyncSync,
  fchmodSync,
  openSync,
  lstatSync,
  mkdirSync,
  unlinkSync,
  linkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { IncomingMessage } from "node:http";
export const MAX_BYTES = 8 * 1024 ** 3;
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/,
  SHA = /^[0-9a-f]{64}$/;
export function allowedUrl(url: string, allowedHosts: ReadonlySet<string>) {
  const m = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(url);
  const u = new URL(url),
    host = u.hostname;
  if (
    !m ||
    !allowedHosts.has(host) ||
    !HOST.test(host) ||
    !host.includes(".") ||
    ![host, host + ":443"].includes(m[1]) ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    url.includes("#") ||
    /[\x00-\x20\x7f\\]/.test(url)
  )
    throw Error("Unapproved HTTPS URL");
  if (isIP(host)) throw Error("DNS hostname required");
  return u;
}
const deny4 = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  deny4.addSubnet(ip, bits, "ipv4");
const allow6 = new BlockList(),
  deny6 = new BlockList();
allow6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  deny6.addSubnet(ip, bits, "ipv6");
export function publicAddress(value: string) {
  const family = isIP(value);
  if (
    !family ||
    value.includes("%") ||
    (family === 4 && deny4.check(value, "ipv4")) ||
    (family === 6 && (!allow6.check(value, "ipv6") || deny6.check(value, "ipv6")))
  )
    throw Error("Non-public DNS answer");
  return value;
}
export async function resolvePublic(
  host: string,
  resolver: (host: string) => Promise<{ address: string }[]> = (h) => lookup(h, { all: true }),
) {
  const ips = [...new Set((await resolver(host)).map((x) => publicAddress(x.address)))];
  if (!ips.length) throw Error("No public DNS answers");
  return ips.sort((a, b) => isIP(a) - isIP(b));
}
export async function checkedStream(
  stream: AsyncIterable<Uint8Array>,
  write: (data: Buffer) => void,
  expectedSha: string,
  maxBytes: number,
  expectedBytes?: number,
  deadline?: number,
) {
  const digest = createHash("sha256");
  let count = 0;
  for await (const chunk of stream) {
    if (deadline !== undefined && performance.now() >= deadline)
      throw Error("Download exceeded deadline");
    const data = Buffer.from(chunk);
    count += data.length;
    if (count > maxBytes) throw Error("Image exceeds bound");
    digest.update(data);
    write(data);
  }
  if (
    count < 512 ||
    digest.digest("hex") !== expectedSha ||
    (expectedBytes !== undefined && count !== expectedBytes)
  )
    throw Error("Image size or digest mismatch");
  return count;
}
function rawHeaders(response: IncomingMessage, name: string) {
  const values: string[] = [];
  for (let i = 0; i < response.rawHeaders.length; i += 2)
    if (response.rawHeaders[i].toLowerCase() === name.toLowerCase())
      values.push(response.rawHeaders[i + 1]);
  return values;
}
function remaining(deadline: number) {
  const n = Math.floor(deadline - performance.now());
  if (n <= 0) throw Error("Download exceeded deadline");
  return n;
}
function pinnedResponse(u: URL, address: string, deadline: number) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      {
        hostname: publicAddress(address),
        port: 443,
        servername: u.hostname,
        checkServerIdentity: (_host, cert) => checkServerIdentity(u.hostname, cert),
        rejectUnauthorized: true,
        path: u.pathname + u.search,
        method: "GET",
        agent: false,
        signal: AbortSignal.timeout(remaining(deadline)),
        headers: {
          Host: u.hostname,
          "Accept-Encoding": "identity",
          Connection: "close",
          "User-Agent": "vm-interface-authorized-image-client/1",
        },
      },
      resolve,
    );
    req.setTimeout(Math.min(30000, remaining(deadline)), () =>
      req.destroy(Error("Pinned HTTPS timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}
async function boundedDns(host: string, deadline: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolvePublic(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("DNS deadline exceeded")), remaining(deadline));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function download(
  url: string,
  allowedHosts: ReadonlySet<string>,
  write: (data: Buffer) => void,
  sha: string,
  maxBytes: number,
  expectedBytes: number | undefined,
  timeout: number,
) {
  const deadline = performance.now() + timeout * 1000;
  for (let redirects = 0; redirects < 6; redirects++) {
    const u = allowedUrl(url, allowedHosts),
      addresses = await boundedDns(u.hostname, deadline);
    let response: IncomingMessage | undefined;
    for (const address of addresses) {
      remaining(deadline);
      try {
        response = await pinnedResponse(u, address, deadline);
        break;
      } catch {
        /* Try only another checked public address. */
      }
    }
    if (!response) throw Error("No approved address could connect");
    try {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const locations = rawHeaders(response, "Location");
        if (locations.length !== 1) throw Error("Ambiguous redirect");
        url = new URL(locations[0], url).href;
        allowedUrl(url, allowedHosts);
        continue;
      }
      if (status !== 200) throw Error("Image source HTTP status " + status);
      const encodings = rawHeaders(response, "Content-Encoding");
      if (encodings.length > 1 || (encodings[0] ?? "identity").toLowerCase() !== "identity")
        throw Error("Encoded response refused");
      const lengths = rawHeaders(response, "Content-Length");
      let length: number | undefined;
      if (lengths.length) {
        if (lengths.length !== 1 || !/^[0-9]+$/.test(lengths[0]))
          throw Error("Ambiguous content length");
        length = Number(lengths[0]);
        if (!Number.isSafeInteger(length) || length < 512 || length > maxBytes)
          throw Error("Advertised image size exceeds bound");
        if (expectedBytes !== undefined && length !== expectedBytes)
          throw Error("Advertised size differs from pin");
      }
      return await checkedStream(response, write, sha, maxBytes, expectedBytes ?? length, deadline);
    } finally {
      response.destroy();
    }
  }
  throw Error("Too many redirects");
}
function exists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
function privateCache(root: string) {
  mkdirSync(root, { mode: 0o700, recursive: true });
  const info = lstatSync(root);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077)
    throw Error("Cache must be an owned, private directory");
  return root;
}
function writeAll(fd: number, data: Buffer) {
  let n = 0;
  while (n < data.length) {
    const count = writeSync(fd, data, n, data.length - n);
    if (!count) throw Error("Short write");
    n += count;
  }
}
function remove(path: string) {
  try {
    unlinkSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
async function copyCache(
  source: string,
  write: (data: Buffer) => void,
  digest: string,
  limit: number,
  size?: number,
) {
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid?.()) throw Error("Invalid cache entry");
    return await checkedStream(
      createReadStream(source, { fd, autoClose: false, highWaterMark: 1024 ** 2 }),
      write,
      digest,
      limit,
      size,
    );
  } finally {
    closeSync(fd);
  }
}
function tempFile(dir: string, prefix: string) {
  const path = join(dir, prefix + randomUUID());
  return { path, fd: openSync(path, "wx", 0o600) };
}
export async function acquire(
  url: string,
  output: string,
  sha256: string,
  allowedHosts: ReadonlySet<string>,
  maxBytes = MAX_BYTES,
  expectedBytes?: number,
  cache?: string,
  timeout = 600,
  downloader = download,
) {
  if (
    !SHA.test(sha256) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 512 ||
    maxBytes > MAX_BYTES
  )
    throw Error("Invalid digest or size bound");
  if (
    expectedBytes !== undefined &&
    (!Number.isSafeInteger(expectedBytes) || expectedBytes < 512 || expectedBytes > maxBytes)
  )
    throw Error("Invalid expected size");
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600)
    throw Error("Invalid timeout");
  const source = allowedUrl(url, allowedHosts);
  if (exists(output)) throw Error("Refusing to overwrite output");
  const entry = cache !== undefined ? join(privateCache(cache), sha256) : undefined;
  const temp = tempFile(dirname(output), ".image-part-"),
    cached = entry !== undefined && exists(entry);
  try {
    let count: number;
    try {
      const write = (b: Buffer) => writeAll(temp.fd, b);
      count = cached
        ? await copyCache(entry!, write, sha256, maxBytes, expectedBytes)
        : await downloader(url, allowedHosts, write, sha256, maxBytes, expectedBytes, timeout);
      fsyncSync(temp.fd);
    } finally {
      closeSync(temp.fd);
    }
    if (entry !== undefined && !cached) {
      const c = tempFile(dirname(entry), ".cache-part-");
      try {
        try {
          await checkedStream(
            createReadStream(temp.path),
            (b) => writeAll(c.fd, b),
            sha256,
            maxBytes,
            expectedBytes,
          );
          fsyncSync(c.fd);
          fchmodSync(c.fd, 0o400);
        } finally {
          closeSync(c.fd);
        }
        try {
          linkSync(c.path, entry);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
      } finally {
        remove(c.path);
      }
    }
    linkSync(temp.path, output);
    return {
      bytes: count,
      sha256,
      sourceHost: source.hostname,
      authorizedByClient: true,
      cacheHit: cached,
    };
  } finally {
    remove(temp.path);
  }
}
