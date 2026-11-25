import {createHash,randomUUID} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {database,operations} from "./db";
import {ApiError} from "./kube";

export const PENDING_TIMEOUT_MS=5*60*1000;
const uncertain={error:"Outcome uncertain; reconciliation required"};
type OperationRow=typeof operations.$inferSelect;

export function pendingIsStale(createdAt:Date|string|number,now=Date.now()){
 const started=createdAt instanceof Date?createdAt.getTime():typeof createdAt==="number"?createdAt:Date.parse(createdAt);
 return !Number.isFinite(started)||now-started>PENDING_TIMEOUT_MS;
}
export function replaySubmission(o:Pick<OperationRow,"id"|"status"|"result">){
 if(o.status==="rejected"){
  const result=o.result as {error?:unknown;httpStatus?:unknown}|null;
  const status=typeof result?.httpStatus==="number"&&[400,404,409,422].includes(result.httpStatus)?result.httpStatus:409;
  throw new ApiError(status,typeof result?.error==="string"?result.error:"Previous submission rejected");
 }
 return {operationId:o.id,status:o.status,result:o.result};
}
async function normalizePending(o:OperationRow):Promise<OperationRow>{
 if(o.status!=="pending"||!pendingIsStale(o.createdAt))return o;
 const where=and(eq(operations.account,o.account),eq(operations.id,o.id));
 // Compare-and-set prevents a stale observer overwriting a completed submission.
 const [changed]=await database().update(operations).set({status:"unknown",result:uncertain}).where(and(where,eq(operations.status,"pending"))).returning();
 if(changed)return changed;
 const [latest]=await database().select().from(operations).where(where);
 if(!latest)throw new ApiError(404,"Operation not found");
 return latest;
}
export async function mutate(account:string,key:string|null,request:unknown,run:(id:string)=>Promise<unknown>){
 if(!key || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new ApiError(400,"Valid Idempotency-Key required");
 const requestHash=createHash("sha256").update(JSON.stringify(request)).digest("hex");
 const db=database(), id=randomUUID();
 const inserted=await db.insert(operations).values({account,key,id,requestHash,status:"pending"}).onConflictDoNothing().returning();
 const where=and(eq(operations.account,account),eq(operations.key,key));
 if(!inserted.length){
  const [existing]=await db.select().from(operations).where(where);
  if(!existing || existing.requestHash!==requestHash)throw new ApiError(409,"Idempotency key reused for different request");
  return replaySubmission(await normalizePending(existing));
 }
 try {
  const result=await run(id);
  await db.update(operations).set({status:"submitted",result}).where(where);
  return {operationId:id,status:"submitted",result};
 } catch(e){
  // Only the original submitter records the known outcome. Observers never replay it.
  const rejected=e instanceof ApiError && [400,404,409,422].includes(e.status);
  await db.update(operations).set({status:rejected?"rejected":"unknown",result:rejected?{error:e.message,httpStatus:e.status}:uncertain}).where(where);
  throw e;
 }
}
export async function operation(account:string,id:string){
 const [row]=await database().select().from(operations).where(and(eq(operations.account,account),eq(operations.id,id)));
 if(!row)throw new ApiError(404,"Operation not found");
 const o=await normalizePending(row);
 return {id:o.id,status:o.status,result:o.result,createdAt:o.createdAt};
}
