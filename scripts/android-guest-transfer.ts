/** Explicit authorized, non-root ARM64 ADB over private product API tunnel. */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { client, wait, type CallOptions } from "./api-client.ts";
import { tarMembers } from "./verify_csi_evidence.ts";
const ROOT = fileURLToPath(new URL("../", import.meta.url)),
  GUEST_DIR = "/sdcard/Documents/VMInterface",
  PACKAGE = "org.vminterface.proof",
  MAX_BUNDLE = 32 * 1024 ** 2;
export const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export function verifyStagedBundle(raw: Buffer, expected: Record<string, Buffer>) {
  assert(
    raw.length <= MAX_BUNDLE &&
      Object.keys(expected).sort().join(",") === "challenge.bin,proof.apk",
    "Invalid staged exchange bundle",
  );
  const members = tarMembers(raw, MAX_BUNDLE),
    names = [...Object.keys(expected).map((n) => "upload/" + n), "manifest.json"].sort();
  assert.deepEqual([...members.keys()].sort(), names, "Unexpected bundle members");
  const manifest = members.get("manifest.json")!;
  assert(manifest.length <= 65536, "Oversized manifest");
  const m = JSON.parse(manifest.toString("utf8"));
  assert(
    m.version === 1 && m.scope === "published-exchange-files-only",
    "Unexpected bundle manifest",
  );
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name),
    wanted = Object.entries(expected)
      .map(([n, b]) => ({
        name: "upload/" + n,
        bytes: b.length,
        sha256: digest(b),
        direction: "upload",
      }))
      .sort(byName);
  assert(Array.isArray(m.files));
  assert.deepEqual([...m.files].sort(byName), wanted, "Bundle manifest mismatch");
  const result: Record<string, Buffer> = {};
  for (const [name, data] of Object.entries(expected)) {
    const actual = members.get("upload/" + name)!;
    assert(actual.equals(data), "Staged input differs from original");
    result[name] = actual;
  }
  return result;
}
export function deviceState(output: Buffer, serial: string | null) {
  const rows = new TextDecoder("utf-8", { fatal: true })
    .decode(output)
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim())
    .map((x) => x.trim().split(/\s+/));
  assert(
    rows.length <= 1 && rows.every((r) => r.length >= 2 && r[0] === serial),
    "Isolated ADB server has an unexpected device",
  );
  return rows[0]?.[1] ?? null;
}
export function requireGuestSecurity(secure: string, enforcing: string, uid: string, abi: string) {
  assert(
    secure === "1" && enforcing === "Enforcing" && uid === "2000" && abi === "arm64-v8a",
    "Require authenticated non-root ARM64 ADB with SELinux Enforcing",
  );
}
async function freePort() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const a = s.address();
  assert(a && typeof a !== "string");
  await new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())));
  return a.port;
}
async function terminate(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ended,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await ended;
  }
}
function childReady(child: ChildProcess) {
  return new Promise<number>((resolve, reject) => {
    let data = "",
      done = false;
    const finish = (e?: Error, port?: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (e) reject(e);
      else resolve(port!);
    };
    const timer = setTimeout(() => finish(Error("Private loopback relay did not start")), 15000);
    child.on("error", (e) => finish(e));
    child.on("exit", () => finish(Error("Private relay exited")));
    assert(child.stdout);
    child.stdout.on("data", (b: Buffer) => {
      if (done) return;
      data += b.toString("utf8");
      if (data.length > 4096) return finish(Error("Unexpected relay output"));
      const nl = data.indexOf("\n");
      if (nl >= 0) {
        try {
          const p = JSON.parse(data.slice(0, nl)).port;
          assert(Number.isInteger(p) && p >= 1 && p <= 65535);
          finish(undefined, p);
        } catch {
          finish(Error("Invalid private relay readiness"));
        }
      }
    });
  });
}
type Api = ReturnType<typeof client>;
type Grant = {
  id: string;
  port: number;
  active: boolean;
  access: string;
  path: string;
  token: string;
};
export class AndroidGuestTransfer {
  private tmp: string;
  private env: NodeJS.ProcessEnv;
  private port = 0;
  private server?: ChildProcess;
  private relay?: ChildProcess;
  private grant?: Grant;
  private serial: string | null = null;
  private expires = 0;
  private call: Api["call"];
  private path: string;
  private tokenB: string;
  readonly report: Record<string, unknown> = {
    transferPath: "authorized-adb-over-private-tunnel",
    freshKeyAuthorized: false,
  };
  private constructor(call: Api["call"], path: string, tokenB: string) {
    this.call = call;
    this.path = path;
    this.tokenB = tokenB;
    this.tmp = mkdtempSync(join(tmpdir(), "vm-android-adb-"));
    this.env = { ...process.env };
    for (const n of [
      "ADB_SERVER_SOCKET",
      "ANDROID_ADB_SERVER_PORT",
      "ADB_SERVER_PORT",
      "ANDROID_SERIAL",
      "ANDROID_SDK_HOME",
      "ADB_VENDOR_KEYS",
      "TOKEN_A",
      "TOKEN_B",
      "GUEST_RELAY_TOKEN",
    ])
      delete this.env[n];
    Object.assign(this.env, { HOME: this.tmp, ANDROID_USER_HOME: this.tmp });
  }
  static async create(call: Api["call"], path: string, tokenB: string) {
    const self = new AndroidGuestTransfer(call, path, tokenB);
    try {
      const key = join(self.tmp, "adbkey");
      self.execute(["keygen", key], 15);
      self.env.ADB_VENDOR_KEYS = key;
      self.port = await freePort();
      self.server = spawn("adb", ["-L", "tcp:127.0.0.1:" + self.port, "nodaemon", "server"], {
        env: self.env,
        stdio: "ignore",
      });
      let failure: Error | undefined;
      self.server.on("error", (e) => {
        failure = e;
      });
      await wait(
        async () => {
          if (failure) throw failure;
          if (self.server?.exitCode !== null) throw Error("Isolated ADB server exited");
          return new Promise<boolean>((resolve) => {
            const s = createConnection(self.port, "127.0.0.1");
            s.setTimeout(1000, () => s.destroy());
            s.once("connect", () => {
              s.destroy();
              resolve(true);
            });
            s.once("error", () => resolve(false));
            s.once("close", () => resolve(false));
          });
        },
        15,
        "ADB server did not start",
      );
      return self;
    } catch (e) {
      await self.close();
      throw e;
    }
  }
  private execute(args: string[], seconds = 30, check = true) {
    const r = spawnSync("adb", args, {
      env: this.env,
      timeout: seconds * 1000,
      maxBuffer: 16 * 1024 ** 2,
    });
    if (r.error) throw r.error;
    if (check && r.status !== 0) throw Error("ADB command failed");
    return r.stdout;
  }
  private command(args: string[], target = false, seconds = 30, check = true) {
    assert(!target || this.serial, "Missing explicit isolated target");
    return this.execute(
      [
        "-H",
        "127.0.0.1",
        "-P",
        String(this.port),
        ...(target ? ["-s", this.serial!] : []),
        ...args,
      ],
      seconds,
      check,
    );
  }
  private state() {
    return deviceState(this.command(["devices"]), this.serial);
  }
  async disconnect() {
    if (this.serial)
      try {
        this.command(["disconnect", this.serial], false, 10, false);
      } catch {
        /* bounded cleanup */
      }
    this.serial = null;
    await terminate(this.relay);
    this.relay = undefined;
    if (this.grant) {
      await this.call("DELETE", this.path + "/exposures/" + this.grant.id, {
        phase: "guest transfer revoke",
      });
      this.grant = undefined;
    }
    this.expires = 0;
  }
  private async open() {
    await this.disconnect();
    const body = { port: 5555, ttlSeconds: 600, access: "private-tunnel" };
    await this.call("POST", this.path + "/exposures", {
      token: this.tokenB,
      body,
      expected: 404,
      phase: "guest transfer ownership denial",
    });
    const grant: Grant = await this.call("POST", this.path + "/exposures", {
      body,
      expected: 201,
      phase: "guest transfer grant",
    });
    this.grant = grant;
    assert(
      grant.port === 5555 &&
        grant.access === "private-tunnel" &&
        grant.active === true &&
        grant.path === "/api/v1" + this.path + "/exposures/" + grant.id + "/connect",
    );
    const gateway = process.env.VNC_URL ?? "wss://127.0.0.1:3443/api/v1";
    assert(gateway.endsWith("/api/v1"));
    const env = {
      ...this.env,
      GUEST_RELAY_URL: gateway.slice(0, -7) + grant.path,
      GUEST_RELAY_TOKEN: grant.token,
    };
    this.relay = spawn(
      process.execPath,
      ["--import", "tsx", join(ROOT, "scripts/guest-tcp-relay.ts")],
      { cwd: ROOT, env, stdio: ["ignore", "pipe", "ignore"] },
    );
    const port = await childReady(this.relay);
    this.serial = "127.0.0.1:" + port;
    this.expires = performance.now() + 540000;
  }
  private async connect() {
    if (!this.serial || performance.now() >= this.expires || this.relay?.exitCode !== null)
      await this.open();
    this.command(["connect", this.serial!], false, 20, false);
    return this.state();
  }
  async authorize(checkpoint: () => Promise<void>) {
    await this.open();
    await wait(
      async () => {
        const s = await this.connect();
        assert(s !== "device", "Fresh key accepted without user authorization; refusing debug");
        return s === "unauthorized";
      },
      60,
      "Guest did not expose authenticated ADB on private tunnel",
    );
    await checkpoint();
    await this.ensure();
    this.report.freshKeyAuthorized = true;
  }
  async ensure(checkpoint?: () => Promise<void>) {
    const s = await wait(
      async () => {
        const s = await this.connect();
        return s === "device" || (s === "unauthorized" && checkpoint) ? s : null;
      },
      60,
      "Authorized guest ADB unavailable",
    );
    if (s === "unauthorized") {
      assert(checkpoint);
      await checkpoint();
      await wait(
        async () => (await this.connect()) === "device",
        60,
        "ADB reauthorization unavailable",
      );
      this.report.rebootKeyReauthorized = true;
    }
    const vals = [
      ["getprop", "ro.adb.secure"],
      ["getenforce"],
      ["id", "-u"],
      ["getprop", "ro.product.cpu.abi"],
    ].map((args) =>
      this.command(["shell", ...args], true)
        .toString()
        .trim(),
    );
    requireGuestSecurity(vals[0], vals[1], vals[2], vals[3]);
    const sdk = this.command(["shell", "getprop", "ro.build.version.sdk"], true).toString().trim();
    assert(/^[0-9]+$/.test(sdk) && Number(sdk) >= 23, "Unexpected Android SDK");
    Object.assign(this.report, {
      adbSecure: true,
      selinux: "Enforcing",
      shellUid: 2000,
      abi: "arm64-v8a",
      sdk: Number(sdk),
    });
  }
  async install(apk: string, challenge: string) {
    await this.ensure();
    this.command(["shell", "mkdir", "-p", "/sdcard/Documents"], true);
    this.command(["shell", "mkdir", GUEST_DIR], true);
    this.command(["push", challenge, GUEST_DIR + "/in-challenge.bin"], true, 60);
    const actual = this.command(["shell", "sha256sum", GUEST_DIR + "/in-challenge.bin"], true)
      .toString()
      .split(/\s+/)[0];
    assert.equal(
      actual,
      digest(readFileSync(challenge)),
      "Guest challenge copy differs from API bytes",
    );
    const result = this.command(["install", apk], true, 90).toString().trim().split(/\r?\n/);
    assert.equal(result.at(-1), "Success", "Android package installation failed");
    assert(
      this.command(["shell", "pm", "path", PACKAGE], true).toString().startsWith("package:"),
      "Expected package not installed",
    );
    this.command(["shell", "am", "start", "-n", PACKAGE + "/.ProofActivity"], true);
    Object.assign(this.report, {
      installedApkSha256: digest(readFileSync(apk)),
      guestChallengeSha256: actual,
      package: PACKAGE,
    });
  }
  async absent() {
    await this.ensure();
    assert.deepEqual(
      this.command(["shell", "ls", "-1", GUEST_DIR], true).toString().trimEnd().split(/\r?\n/),
      ["in-challenge.bin"],
      "Unexpected guest exchange contents before action",
    );
  }
  async result() {
    await this.ensure();
    const data = this.command(
        ["exec-out", "head", "-c", "1025", GUEST_DIR + "/out-result.txt"],
        true,
      ),
      marker = this.command(
        ["exec-out", "head", "-c", "129", GUEST_DIR + "/out-result.txt.sha256"],
        true,
      );
    assert(
      data.length > 0 && data.length <= 1024 && marker.equals(Buffer.from(digest(data) + "\n")),
      "Guest output absent, oversized or checksum mismatch",
    );
    this.report.guestOutputSha256 = digest(data);
    return data;
  }
  async close() {
    try {
      await this.disconnect();
    } finally {
      await terminate(this.server);
      rmSync(this.tmp, { recursive: true, force: true });
    }
  }
}
export type GuestCallOptions = CallOptions;
