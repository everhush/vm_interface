import {createHash,randomBytes,randomUUID} from "node:crypto";
import {and,eq,gt,gte,isNull,lte,sql} from "drizzle-orm";
import {database,consoleTickets,accountKeys} from "./db";
import {ApiError,owned} from "./kube";
import {runningDisplay} from "./screenshot";

export const TICKET_TTL_MS=120000;
export type DisplayScope="screenshot-only"|"observe-vnc"|"control-vnc";
export type Actor="observer"|"human"|"automation";
export type TicketTx=Parameters<Parameters<ReturnType<typeof database>["transaction"]>[0]>[0];
const maxPerAccount=16,maxPerComputer=4;
type Ticket=typeof consoleTickets.$inferSelect;
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
export function displayToken(authorization:string|null){
 return /^Console ([A-Za-z0-9_-]{43})$/.exec(authorization??"")?.[1]??null;
}
export function validTicket(t:Pick<Ticket,"computerId"|"expiresAt"|"revokedAt">,computerId:string,now=Date.now()){
 return t.computerId===computerId&&t.revokedAt===null&&t.expiresAt.getTime()>now;
}
function publicTicket(t:Ticket){
 return {id:t.id,computerId:t.computerId,scope:t.scope,actor:t.actor,instanceUid:t.instanceUid,createdAt:t.createdAt,expiresAt:t.expiresAt,revokedAt:t.revokedAt};
}
export async function issueDisplayTicket(account:string,computerId:string,scope:DisplayScope="screenshot-only",issuedKeyId?:string){
 const instanceUid=await runningDisplay(computerId,account);
 const token=randomBytes(32).toString("base64url");
 return database().transaction(async tx=>{
  const locked=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:display-ticket:"+account},0)) AS locked`);
  if(locked[0]?.locked!==true)throw new ApiError(409,"Another ticket issuance is in progress");
  const now=new Date();
  const actor:Actor=scope==="control-vnc"?(issuedKeyId?"automation":"human"):"observer";
  const recent=await tx.select({id:consoleTickets.id}).from(consoleTickets).where(and(eq(consoleTickets.account,account),gte(consoleTickets.createdAt,new Date(now.getTime()-60000)))).limit(24);
  if(recent.length>=24)throw new ApiError(409,"Display ticket issuance rate exceeded");
  await tx.delete(consoleTickets).where(and(eq(consoleTickets.account,account),lte(consoleTickets.expiresAt,new Date(now.getTime()-60000))));
  const active=await tx.select({computerId:consoleTickets.computerId}).from(consoleTickets).where(and(eq(consoleTickets.account,account),gt(consoleTickets.expiresAt,now),isNull(consoleTickets.revokedAt)));
  if(active.length>=maxPerAccount||active.filter(t=>t.computerId===computerId).length>=maxPerComputer)throw new ApiError(409,"Active display ticket limit exceeded");
  const [row]=await tx.insert(consoleTickets).values({id:randomUUID(),account,computerId,instanceUid,scope,actor,issuedKeyId:issuedKeyId??null,tokenHash:hash(token),expiresAt:new Date(now.getTime()+TICKET_TTL_MS)}).returning();
  return {...publicTicket(row),token,authorizationScheme:"Console"};
 });
}
export async function lockedDisplayTicket(tx:TicketTx,token:string,computerId:string){
 const [t]=await tx.select().from(consoleTickets).where(eq(consoleTickets.tokenHash,hash(token))).for("update");
 if(!t||!validTicket(t,computerId))throw new ApiError(401,"Invalid or expired display ticket");
 if(t.issuedKeyId){
  const [key]=await tx.select().from(accountKeys).where(and(eq(accountKeys.id,t.issuedKeyId),eq(accountKeys.account,t.account))).for("update");
  if(!key||key.revokedAt||key.expiresAt.getTime()<=Date.now()||key.permission!=="manage")throw new ApiError(401,"Issuing account key is inactive");
 }
 return t;
}
export async function lookupDisplayTicket(token:string,computerId:string){
 return database().transaction(async tx=>{
  const t=await lockedDisplayTicket(tx,token,computerId);
  return {id:t.id,account:t.account,instanceUid:t.instanceUid,scope:t.scope,actor:t.actor,expiresAt:t.expiresAt};
 });
}
export async function listDisplayTickets(account:string,computerId:string){
 await owned(computerId,account);
 const rows=await database().select().from(consoleTickets).where(and(eq(consoleTickets.account,account),eq(consoleTickets.computerId,computerId),gt(consoleTickets.expiresAt,new Date())));
 return rows.map(publicTicket);
}
export async function revokeDisplayTicket(account:string,computerId:string,id:string){
 await owned(computerId,account);
 if(!/^[0-9a-f-]{36}$/.test(id))throw new ApiError(404,"Display ticket not found");
 const where=and(eq(consoleTickets.account,account),eq(consoleTickets.computerId,computerId),eq(consoleTickets.id,id));
 const [row]=await database().update(consoleTickets).set({revokedAt:new Date()}).where(and(where,isNull(consoleTickets.revokedAt))).returning();
 if(row)return publicTicket(row);
 const [old]=await database().select().from(consoleTickets).where(where);
 if(!old)throw new ApiError(404,"Display ticket not found");
 return publicTicket(old);
}
