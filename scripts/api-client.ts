/** Shared API-only integration client. Never logs credentials, request or response bodies. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export const sleep = (seconds: number) => delay(seconds * 1000);
export const sha = (data: Buffer | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const key = () => randomUUID().replaceAll("-", "");
export type CallOptions = {
  token?: string;
  body?: unknown;
  expected?: number | readonly number[];
  scheme?: string;
  idem?: string;
  phase?: string;
  raw?: Buffer | Uint8Array;
  headers?: Record<string, string>;
  timeout?: number;
};
export class ResponseMismatch extends Error {
  readonly status: number;
  readonly result: Record<string, unknown>;
  constructor(method: string, path: string, status: number, body: Buffer) {
    super(method + " " + path + ": unexpected HTTP " + status);
    this.status = status;
    try {
      this.result = JSON.parse(body.toString("utf8"));
    } catch {
      this.result = {};
    }
  }
}
type Trace = {
  elapsedMs: number;
  method: string;
  path: string;
  status: number;
  expected: number;
  responseMs: number;
  phase?: string;
};
async function boundedBody(response: Response, limit: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw Error("API response exceeded bound");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}
export function client(options: { out?: string; automaticKeys?: boolean; timeout?: number } = {}) {
  const base = process.env.API_URL ?? "http://127.0.0.1:3000/api/v1",
    A = process.env.TOKEN_A,
    B = process.env.TOKEN_B;
  assert(A && B, "Explicit test account tokens required");
  const events: Trace[] = [],
    started = performance.now(),
    trace = options.out ? join(options.out, "http-trace.jsonl") : undefined;
  if (options.out) {
    mkdirSync(options.out, { recursive: true });
    writeFileSync(trace!, "");
  }
  async function request(method: string, path: string, o: CallOptions = {}) {
    assert(path.startsWith("/") && !path.startsWith("//"), "Expected API path");
    const headers: Record<string, string> = {
      authorization: (o.scheme ?? "Bearer") + " " + (o.token ?? A),
      connection: "close",
    };
    if (o.raw !== undefined || o.body !== undefined || options.automaticKeys)
      headers["content-type"] = "application/json";
    const idem = o.idem ?? (options.automaticKeys ? randomUUID() : undefined);
    if (idem) headers["idempotency-key"] = idem;
    const t = performance.now(),
      res = await fetch(base + path, {
        method,
        headers: { ...headers, ...o.headers },
        ...(o.raw !== undefined
          ? { body: Uint8Array.from(o.raw) }
          : o.body !== undefined
            ? { body: JSON.stringify(o.body) }
            : {}),
        redirect: "error",
        signal: AbortSignal.timeout((o.timeout ?? options.timeout ?? 30) * 1000),
      });
    const data = await boundedBody(res, res.status >= 400 ? 16384 : 65 * 1024 ** 2);
    const allowed = typeof o.expected === "number" ? [o.expected] : (o.expected ?? [200]),
      expected = allowed.includes(res.status) ? res.status : allowed[0];
    if (trace) {
      const entry = {
        elapsedMs: Math.round(t - started),
        method,
        path,
        status: res.status,
        expected,
        responseMs: Math.round(performance.now() - t),
        ...(o.phase ? { phase: o.phase } : {}),
      };
      events.push(entry);
      appendFileSync(trace, JSON.stringify(entry) + "\n");
      if (o.phase || res.status !== expected) console.log(method, path, res.status, o.phase ?? "");
    }
    if (!allowed.includes(res.status)) throw new ResponseMismatch(method, path, res.status, data);
    return { data, headers: res.headers, status: res.status };
  }
  return {
    A,
    B,
    events,
    trace,
    request,
    async call(method: string, path: string, o: CallOptions = {}) {
      const res = await request(method, path, o);
      return JSON.parse(res.data.toString("utf8"));
    },
    async binary(method: string, path: string, o: CallOptions = {}) {
      const res = await request(method, path, o);
      return [res.data, res.headers] as const;
    },
  };
}
export async function wait<T>(
  check: () => T | Promise<T>,
  seconds: number,
  reason: string,
  interval = 1.5,
): Promise<NonNullable<T>> {
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    const result = await check();
    if (result) return result as NonNullable<T>;
    await sleep(interval);
  }
  throw Error(reason);
}
export const writeJson = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
