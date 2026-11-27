import { ApiError } from "./kube";
let active = 0;
export async function boundedBody(req: Request, max: number, timeoutMs = 30000) {
  if (!req.body) return Buffer.alloc(0);
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max))
    throw new ApiError(413, "Request body exceeds limit");
  if (active >= 8) throw new ApiError(429, "Body receiver busy");
  const reader = req.body.getReader();
  active++;
  let expired = false,
    size = 0;
  const chunks: Buffer[] = [];
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  try {
    for (;;) {
      const next = await reader.read();
      if (expired) throw new ApiError(400, "Request body deadline exceeded");
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw new ApiError(413, "Request body exceeds limit");
      chunks.push(Buffer.from(next.value));
    }
    if (length !== null && Number(length) !== size)
      throw new ApiError(400, "Request body length mismatch");
    return Buffer.concat(chunks, size);
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    active--;
  }
}
export async function boundedText(req: Request, max: number) {
  return (await boundedBody(req, max)).toString("utf8");
}

/** Drain only bounded authenticated binary PUTs that the handler did not read.
 * This preserves the actual replay/denial response on HTTP transports that
 * reset when request bytes remain unread. No bytes are stored or interpreted. */
let activeDiscards = 0;
export function unreadMediaLimit(req: Request) {
  if (
    req.method !== "PUT" ||
    req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/octet-stream"
  )
    return 0;
  const path = new URL(req.url).pathname;
  if (/^\/api\/v1\/media-artifacts\/[0-9a-f-]{36}\/file$/.test(path)) return 64 * 1024 * 1024;
  const slot =
    /^\/api\/v1\/computers\/vm-[0-9a-f]{32}\/media\/(?:boot|installer|auxiliary|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)(\/chunks)?$/.exec(
      path,
    );
  return slot ? (slot[1] ? 8 : 64) * 1024 * 1024 : 0;
}
export async function discardUnreadBody(req: Request, max: number, timeoutMs = 30000) {
  if (!req.body || req.bodyUsed) return;
  const length = req.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > max)
  )
    throw new ApiError(413, "Request body exceeds limit");
  if (activeDiscards >= 2)
    throw new ApiError(429, "Media response drain busy; inspect operation state");
  const reader = req.body.getReader();
  activeDiscards++;
  let expired = false,
    size = 0;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  try {
    for (;;) {
      const next = await reader.read();
      if (expired) throw new ApiError(400, "Request body deadline exceeded");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) throw new ApiError(413, "Request body exceeds limit");
    }
    if (length !== null && Number(length) !== size)
      throw new ApiError(400, "Request body length mismatch");
  } catch (e) {
    void reader.cancel().catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    activeDiscards--;
  }
}
