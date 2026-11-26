import {createHash,randomUUID} from "node:crypto";
import {and,eq,desc,lt} from "drizzle-orm";
import {database,operations} from "./db";
import {ApiError} from "./kube";
import {observeOperation} from "./reconcile-operation";

export const PENDING_TIMEOUT_MS=5*60*1000;
const uncertain={error:"Outcome uncertain; reconciliation required"};
export type OperationRow=typeof operations.$inferSelect;
export function safeIntent(request:unknown,id:string){
 const r=request as {action?:unknown;id?:unknown;spec?:{cpu?:unknown;memoryMiB?:unknown;first?:unknown;installerTray?:unknown;name?:unknown;disk?:unknown;sizeGiB?:unknown};slot?:unknown};
 const action=typeof r?.action==="string"&&/^[a-z-]{1,40}$/.test(r.action)?r.action:"other";
 const computerId=action==="create"?"vm-"+id.replaceAll("-",""):typeof r?.id==="string"&&/^vm-[a-f0-9]{32}$/.test(r.id)?r.id:null;
 return {action,computerId,...(action==="boot"&&["system","installer"].includes(String(r.spec?.first))?{first:r.spec?.first,...(["open","closed"].includes(String(r.spec?.installerTray))?{installerTray:r.spec?.installerTray}:{})}:{}),...(action==="storage-grow"&&typeof r.spec?.disk==="string"&&/^(system\.disk|exchange\.disk|[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$/.test(r.spec.disk)&&typeof r.spec.sizeGiB==="number"&&Number.isInteger(r.spec.sizeGiB)?{growthDisk:r.spec.disk,sizeGiB:r.spec.sizeGiB}:{}),...(action==="hardware"?{cpu:r.spec?.cpu,memoryMiB:r.spec?.memoryMiB}:{}),...(["disk-create","disk-clone","disk-import","disk-attach","disk-detach"].includes(action)&&typeof r.spec?.name==="string"&&/^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$/.test(r.spec.name)?{diskName:r.spec.name}:{}),...(["media-upload","media-commit"].includes(action)&&/^(boot|installer|auxiliary|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$/.test(String(r.slot))?{slot:r.slot}:{})};
}
export async function recordOperationTarget(account:string,id:string,target:{vmUid:string;previousInstanceUid?:string|null;disks?:string[]}){
 const [row]=await database().update(operations).set({target,updatedAt:new Date()}).where(and(eq(operations.account,account),eq(operations.id,id),eq(operations.status,"pending"))).returning({id:operations.id});
 if(!row)throw new ApiError(409,"Operation lost submission authority");
}

export function pendingIsStale(createdAt:Date|string|number,now=Date.now()){
 const started=createdAt instanceof Date?createdAt.getTime():typeof createdAt==="number"?createdAt:Date.parse(createdAt);
 return !Number.isFinite(started)||now-started>PENDING_TIMEOUT_MS;
}
export function replaySubmission(o:Pick<OperationRow,"id"|"status"|"result">){
 if(o.status==="rejected"){
  const result=o.result as {error?:unknown;httpStatus?:unknown}|null;
  const status=typeof result?.httpStatus==="number"&&[400,401,403,404,409,413,422].includes(result.httpStatus)?result.httpStatus:409;
  throw new ApiError(status,typeof result?.error==="string"?result.error:"Previous submission rejected");
 }
 return {operationId:o.id,status:o.status,result:o.result};
}
export async function normalizePending(o:OperationRow):Promise<OperationRow>{
 if(o.status!=="pending"||!pendingIsStale(o.updatedAt))return o;
 const where=and(eq(operations.account,o.account),eq(operations.id,o.id));
 // Compare-and-set prevents a stale observer overwriting a completed submission.
 const [changed]=await database().update(operations).set({status:"unknown",result:uncertain,updatedAt:new Date()}).where(and(where,eq(operations.status,"pending"),lt(operations.updatedAt,new Date(Date.now()-PENDING_TIMEOUT_MS)))).returning();
 if(changed)return changed;
 const [latest]=await database().select().from(operations).where(where);
 if(!latest)throw new ApiError(404,"Operation not found");
 return latest;
}
export function requireIdempotencyKey(key:string|null){
 if(!key || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new ApiError(400,"Valid Idempotency-Key required");
 return key;
}
export async function mutate(account:string,key:string|null,request:unknown,run:(id:string)=>Promise<unknown>){
 key=requireIdempotencyKey(key);
 const requestHash=createHash("sha256").update(JSON.stringify(request)).digest("hex");
 const db=database(), id=randomUUID();
 const inserted=await db.insert(operations).values({account,key,id,requestHash,status:"pending",intent:safeIntent(request,id)}).onConflictDoNothing().returning();
 const where=and(eq(operations.account,account),eq(operations.key,key));
 if(!inserted.length){
  const [existing]=await db.select().from(operations).where(where);
  if(!existing || existing.requestHash!==requestHash)throw new ApiError(409,"Idempotency key reused for different request");
  return replaySubmission(await normalizePending(existing));
 }
 const heartbeat=setInterval(()=>{void db.update(operations).set({updatedAt:new Date()}).where(and(where,eq(operations.status,"pending"))).catch(()=>{})},15000);
 try {
  const result=await run(id);
  await db.update(operations).set({status:"submitted",result,updatedAt:new Date()}).where(where);
  return {operationId:id,status:"submitted",result};
 } catch(e){
  // Only the original submitter records the known outcome. Observers never replay it.
  const rejected=e instanceof ApiError && [400,401,403,404,409,413,422].includes(e.status);
  await db.update(operations).set({status:rejected?"rejected":"unknown",result:rejected?{error:e.message,httpStatus:e.status}:uncertain,updatedAt:new Date()}).where(where);
  throw e;
 }finally{clearInterval(heartbeat)}
}
function operationView(o:OperationRow){return {id:o.id,status:o.status,result:o.result,intent:o.intent,observation:o.observation,observedAt:o.observedAt,createdAt:o.createdAt,updatedAt:o.updatedAt}}
export async function listOperations(account:string){const rows=await database().select().from(operations).where(eq(operations.account,account)).orderBy(desc(operations.createdAt)).limit(100);return rows.map(operationView)}
export async function operation(account:string,id:string){
 const [row]=await database().select().from(operations).where(and(eq(operations.account,account),eq(operations.id,id)));
 if(!row)throw new ApiError(404,"Operation not found");
 const o=await normalizePending(row);
 return operationView(await observeOperation(o));
}

/** Read-only receipt lookup, never submit a mutation. Key stays in the header. */
export async function operationForKey(account:string,key:string|null){
 const valid=requireIdempotencyKey(key);
 const [row]=await database().select().from(operations).where(and(eq(operations.account,account),eq(operations.key,valid)));
 if(!row)throw new ApiError(404,"Operation not found");
 return operationView(await observeOperation(await normalizePending(row)));
}
