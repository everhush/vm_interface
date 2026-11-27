import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { database, auditEvents } from "./db";
import { ApiError } from "./kube";
const groups = new Set([
  "account",
  "keys",
  "schema",
  "images",
  "media-artifacts",
  "capabilities",
  "openapi.json",
  "operations",
  "audit",
  "computers",
  "quota",
  "plan",
  "storage",
  "disks",
  "disk-exports",
  "hardware",
  "boot",
  "media",
  "files",
  "recordings",
  "input",
  "input-lease",
  "console-tickets",
  "screenshot",
  "guest",
  "start",
  "stop",
  "restart",
  "reset",
  "exposures",
]);
export type AuditContext = {
  account: string;
  actor: "test" | "key" | "console" | "system";
  method: string;
  group: string;
  computerId: string | null;
};
export function auditContext(
  account: string,
  actor: AuditContext["actor"],
  method: string,
  parts: string[],
): AuditContext {
  const vm = parts[0] === "computers" && /^vm-[a-f0-9]{32}$/.test(parts[1] ?? "") ? parts[1] : null;
  const candidate = vm ? (parts[2] ?? "computers") : (parts[0] ?? "unknown");
  return {
    account,
    actor,
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "other",
    group: groups.has(candidate) ? candidate : "other",
    computerId: vm,
  };
}
export async function rateLimit(account: string, now = Date.now()) {
  const window = Math.floor(now / 60000);
  const rows = await database()
    .execute(sql`INSERT INTO api_rate(account,window_start,count) VALUES(${account},${window},1)
 ON CONFLICT(account) DO UPDATE SET window_start=EXCLUDED.window_start,count=CASE WHEN api_rate.window_start=EXCLUDED.window_start THEN api_rate.count+1 ELSE 1 END
 WHERE (api_rate.window_start<EXCLUDED.window_start OR (api_rate.window_start=EXCLUDED.window_start AND api_rate.count<600)) RETURNING count`);
  if (!rows.length) throw new ApiError(429, "Account API limit exceeded; retry next minute");
}
export async function recordAudit(c: AuditContext, status: number) {
  await database()
    .insert(auditEvents)
    .values({ ...c, id: randomUUID(), status });
}
export async function auditHistory(account: string, computerId?: string) {
  return database()
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.account, account),
        ...(computerId ? [eq(auditEvents.computerId, computerId)] : []),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);
}
export async function reapAudit() {
  await database().execute(
    sql`DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE created_at<now()-interval '7 days' ORDER BY created_at LIMIT 1000)`,
  );
  await database().execute(
    sql`DELETE FROM api_rate WHERE window_start<${Math.floor(Date.now() / 60000) - 1440}`,
  );
}
