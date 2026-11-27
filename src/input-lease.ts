import { and, eq, sql } from "drizzle-orm";
import { database, inputLeases, consoleTickets, accountKeys } from "./db";
import { lockedDisplayTicket, type TicketTx } from "./console-tickets";
import { ApiError, owned } from "./kube";
import { runningDisplay } from "./screenshot";

export const LEASE_TTL_MS = 30000;
type Lease = typeof inputLeases.$inferSelect;
type Ticket = typeof consoleTickets.$inferSelect;
type Claim = { ticketId: string; actor: string; instanceUid: string; expiresAt: Date };
export function activeClaim(claim: Claim | null, now = Date.now()) {
  return !!claim && claim.expiresAt.getTime() > now;
}
export function mayAcquire(
  current: Claim | null,
  requested: Pick<Claim, "ticketId" | "actor" | "instanceUid">,
  takeover: boolean,
  now = Date.now(),
) {
  if (
    !current ||
    !activeClaim(current, now) ||
    current.instanceUid !== requested.instanceUid ||
    current.ticketId === requested.ticketId
  )
    return true;
  return takeover && requested.actor === "human" && current.actor === "automation";
}
async function withLock<T>(computerId: string, run: (tx: TicketTx) => Promise<T>) {
  return database().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '1000ms'`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"vm-interface:input:" + computerId},0))`,
    );
    return run(tx);
  });
}
async function currentLease(tx: TicketTx, account: string, computerId: string) {
  const [lease] = await tx
    .select()
    .from(inputLeases)
    .where(and(eq(inputLeases.account, account), eq(inputLeases.computerId, computerId)));
  return lease ?? null;
}
async function effectiveLease(tx: TicketTx, lease: Lease | null) {
  if (!lease || !activeClaim(lease)) return null;
  const [ticket] = await tx
    .select()
    .from(consoleTickets)
    .where(and(eq(consoleTickets.id, lease.ticketId), eq(consoleTickets.account, lease.account)))
    .for("update");
  if (
    !ticket ||
    ticket.revokedAt ||
    ticket.expiresAt.getTime() <= Date.now() ||
    ticket.scope !== "control-vnc" ||
    ticket.instanceUid !== lease.instanceUid
  )
    return null;
  if (ticket.issuedKeyId) {
    const [key] = await tx
      .select()
      .from(accountKeys)
      .where(and(eq(accountKeys.id, ticket.issuedKeyId), eq(accountKeys.account, ticket.account)))
      .for("update");
    if (
      !key ||
      key.revokedAt ||
      key.expiresAt.getTime() <= Date.now() ||
      key.permission !== "manage"
    )
      return null;
  }
  return lease;
}
function control(ticket: Ticket) {
  if (ticket.scope !== "control-vnc" || !["human", "automation"].includes(ticket.actor))
    throw new ApiError(403, "Control ticket required");
}
function describe(lease: Lease | null) {
  return lease && activeClaim(lease)
    ? {
        active: true,
        holderTicketId: lease.ticketId,
        actor: lease.actor,
        instanceUid: lease.instanceUid,
        generation: lease.generation,
        expiresAt: lease.expiresAt,
      }
    : { active: false };
}
export async function acquireInput(token: string, computerId: string, takeover = false) {
  // Read the grant outside the advisory transaction only to determine the
  // account and current VMI; repeat all credential checks under row locks.
  const initial = await database().transaction((tx) => lockedDisplayTicket(tx, token, computerId));
  control(initial);
  if ((await runningDisplay(computerId, initial.account)) !== initial.instanceUid)
    throw new ApiError(401, "Stale display instance");
  return withLock(computerId, async (tx) => {
    const ticket = await lockedDisplayTicket(tx, token, computerId);
    control(ticket);
    const row = await currentLease(tx, ticket.account, computerId),
      current = await effectiveLease(tx, row);
    const claim = { ticketId: ticket.id, actor: ticket.actor, instanceUid: ticket.instanceUid };
    if (!mayAcquire(current, claim, takeover))
      throw new ApiError(409, "Input lease held by another client");
    const now = new Date(),
      expiresAt = new Date(Math.min(now.getTime() + LEASE_TTL_MS, ticket.expiresAt.getTime()));
    const generation =
      current?.ticketId === ticket.id && current.instanceUid === ticket.instanceUid
        ? current.generation
        : (row?.generation ?? 0) + 1;
    const values = {
      computerId,
      account: ticket.account,
      ...claim,
      generation,
      expiresAt,
      updatedAt: now,
    };
    const [lease] = await tx
      .insert(inputLeases)
      .values(values)
      .onConflictDoUpdate({ target: inputLeases.computerId, set: values })
      .returning();
    return describe(lease);
  });
}
export async function releaseInput(token: string, computerId: string) {
  return withLock(computerId, async (tx) => {
    const ticket = await lockedDisplayTicket(tx, token, computerId);
    control(ticket);
    const lease = await effectiveLease(tx, await currentLease(tx, ticket.account, computerId));
    if (!lease) return { active: false };
    if (lease.ticketId !== ticket.id) throw new ApiError(409, "Input lease held by another client");
    await tx
      .update(inputLeases)
      .set({ expiresAt: new Date(), updatedAt: new Date() })
      .where(eq(inputLeases.computerId, computerId));
    return { active: false };
  });
}
export async function inputStatus(account: string, computerId: string) {
  await owned(computerId, account);
  let instance: string;
  try {
    instance = await runningDisplay(computerId, account);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { active: false };
    throw e;
  }
  return withLock(computerId, async (tx) => {
    const lease = await effectiveLease(tx, await currentLease(tx, account, computerId));
    return describe(lease?.instanceUid === instance ? lease : null);
  });
}
// The callback must be synchronous and must only send the validated input to
// the current private RFB connection. Lease transfer and input forwarding
// serialize on the same lock; revocation waits on the ticket/key row locks.
export async function withInputAuthority(
  token: string,
  computerId: string,
  instanceUid: string,
  send: (lease: Lease) => void,
) {
  try {
    return await withLock(computerId, async (tx) => {
      const ticket = await lockedDisplayTicket(tx, token, computerId);
      if (ticket.scope !== "control-vnc" || ticket.instanceUid !== instanceUid) return false;
      const lease = await currentLease(tx, ticket.account, computerId);
      if (
        !lease ||
        !activeClaim(lease) ||
        lease.ticketId !== ticket.id ||
        lease.instanceUid !== instanceUid
      )
        return false;
      send(lease);
      return true;
    });
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 409].includes(e.status)) return false;
    throw e;
  }
}
