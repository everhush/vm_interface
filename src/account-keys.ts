import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { database, accountKeys } from "./db";
import { accountFor } from "./auth";
import { ApiError } from "./kube";

export const keySpec = z.strictObject({
  label: z.string().trim().min(1).max(80),
  permission: z.enum(["read", "manage"]),
  ttlSeconds: z.number().int().min(60).max(2592000),
});
export type KeySpec = z.infer<typeof keySpec>;
type KeyRow = typeof accountKeys.$inferSelect;
type Identity =
  | { account: string; kind: "test-root"; permission: "manage" }
  | { account: string; kind: "account-key"; permission: "read" | "manage"; keyId: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function apiKeyToken(authorization: string | null) {
  return /^Bearer (vmk_[A-Za-z0-9_-]{43})$/.exec(authorization ?? "")?.[1] ?? null;
}
export function keyUsable(
  row: Pick<KeyRow, "revokedAt" | "expiresAt" | "permission">,
  now = Date.now(),
) {
  return (
    row.revokedAt === null &&
    row.expiresAt.getTime() > now &&
    (row.permission === "read" || row.permission === "manage")
  );
}
export function requirePermission(identity: Identity, method: string, keysRoute = false) {
  if (keysRoute && identity.kind !== "test-root")
    throw new ApiError(403, "Key administration requires test account identity");
  if (identity.permission === "read" && method !== "GET")
    throw new ApiError(403, "Account key is read-only");
}
export async function authenticate(authorization: string | null): Promise<Identity | null> {
  const root = accountFor(authorization);
  if (root) return { account: root, kind: "test-root", permission: "manage" };
  const token = apiKeyToken(authorization);
  if (!token) return null;
  const now = new Date();
  const [row] = await database()
    .update(accountKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(accountKeys.tokenHash, digest(token)),
        isNull(accountKeys.revokedAt),
        gt(accountKeys.expiresAt, now),
      ),
    )
    .returning();
  if (!row || !keyUsable(row, now.getTime())) return null;
  return {
    account: row.account,
    kind: "account-key",
    permission: row.permission as "read" | "manage",
    keyId: row.id,
  };
}
const publicKey = (row: KeyRow) => ({
  id: row.id,
  label: row.label,
  permission: row.permission,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  lastUsedAt: row.lastUsedAt,
});
type Tx = Parameters<Parameters<ReturnType<typeof database>["transaction"]>[0]>[0];
async function withKeyLock<T>(account: string, run: (tx: Tx) => Promise<T>) {
  return database().transaction(async (tx) => {
    const rows = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:account-key:" + account},0)) AS locked`,
    );
    if (rows[0]?.locked !== true) throw new ApiError(409, "Another key change is in progress");
    return run(tx);
  });
}
async function enforceLimit(tx: Tx, account: string, now: Date, rotating = false) {
  const recent = await tx
    .select({ id: accountKeys.id })
    .from(accountKeys)
    .where(
      and(
        eq(accountKeys.account, account),
        gte(accountKeys.createdAt, new Date(now.getTime() - 3600000)),
      ),
    )
    .limit(24);
  if (recent.length >= 24) throw new ApiError(409, "Key issuance rate limit exceeded");
  if (!rotating) {
    const active = await tx
      .select({ id: accountKeys.id })
      .from(accountKeys)
      .where(
        and(
          eq(accountKeys.account, account),
          isNull(accountKeys.revokedAt),
          gt(accountKeys.expiresAt, now),
        ),
      )
      .limit(8);
    if (active.length >= 8) throw new ApiError(409, "Active account key limit exceeded");
  }
}
async function insertKey(
  tx: Tx,
  account: string,
  label: string,
  permission: string,
  expiresAt: Date,
) {
  const token = "vmk_" + randomBytes(32).toString("base64url");
  const [row] = await tx
    .insert(accountKeys)
    .values({ id: randomUUID(), account, label, permission, expiresAt, tokenHash: digest(token) })
    .returning();
  return { ...publicKey(row), token };
}
export async function issueKey(account: string, s: KeySpec) {
  return withKeyLock(account, async (tx) => {
    const now = new Date();
    await enforceLimit(tx, account, now);
    return insertKey(
      tx,
      account,
      s.label,
      s.permission,
      new Date(now.getTime() + s.ttlSeconds * 1000),
    );
  });
}
export async function listKeys(account: string) {
  const rows = await database()
    .select()
    .from(accountKeys)
    .where(eq(accountKeys.account, account))
    .orderBy(accountKeys.createdAt);
  return rows.map(publicKey);
}
function whereKey(account: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, "Account key not found");
  return and(eq(accountKeys.account, account), eq(accountKeys.id, id));
}
export async function revokeKey(account: string, id: string) {
  return withKeyLock(account, async (tx) => {
    const where = whereKey(account, id);
    const [row] = await tx
      .update(accountKeys)
      .set({ revokedAt: new Date() })
      .where(and(where, isNull(accountKeys.revokedAt)))
      .returning();
    if (row) return publicKey(row);
    const [old] = await tx.select().from(accountKeys).where(where);
    if (!old) throw new ApiError(404, "Account key not found");
    return publicKey(old);
  });
}
export async function rotateKey(account: string, id: string) {
  return withKeyLock(account, async (tx) => {
    const where = whereKey(account, id),
      now = new Date();
    const [old] = await tx.select().from(accountKeys).where(where);
    if (!old) throw new ApiError(404, "Account key not found");
    if (!keyUsable(old, now.getTime())) throw new ApiError(409, "Cannot rotate inactive key");
    await enforceLimit(tx, account, now, true);
    await tx.update(accountKeys).set({ revokedAt: now }).where(where);
    return insertKey(tx, account, old.label, old.permission, old.expiresAt);
  });
}
