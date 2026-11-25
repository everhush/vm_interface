import {z} from "zod";
import {and,eq,inArray,ne,sql} from "drizzle-orm";
import {database,recordings} from "./db";
import {ApiError} from "./kube";
import {runningDisplay} from "./screenshot";
import {open,unlink} from "node:fs/promises";
import {constants} from "node:fs";
import {join} from "node:path";
import {Readable} from "node:stream";

export const recordingSpec=z.strictObject({consent:z.literal(true),maxSeconds:z.number().int().min(3).max(120).default(30)});
export const RECORDING_MAX_BYTES=64*1024*1024;
export const RECORDING_DIR="/var/lib/vm-recordings";
export const activeRecordingStates=["queued","recording","stopping"];
type Recording=typeof recordings.$inferSelect;
export type RecordingSpec=z.infer<typeof recordingSpec>;
export function recordingPath(id:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new ApiError(404,"Recording not found");
 return join(RECORDING_DIR,id+".mp4");
}
function publicRecord(r:Recording){
 return {id:r.id,computerId:r.computerId,instanceUid:r.instanceUid,status:r.status,consentAt:r.consentAt,
  maxSeconds:r.maxSeconds,createdAt:r.createdAt,startedAt:r.startedAt,stopRequestedAt:r.stopRequestedAt,
  finishedAt:r.finishedAt,durationMs:r.durationMs,bytes:r.bytes,sha256:r.sha256,
  contentType:r.status==="completed"?"video/mp4":null,error:r.error};
}
export async function startRecording(account:string,computerId:string,id:string,spec:RecordingSpec){
 recordingPath(id);
 const instanceUid=await runningDisplay(computerId,account);
 return database().transaction(async tx=>{
  const rows=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:recording:"+account},0)) AS locked`);
  if(rows[0]?.locked!==true)throw new ApiError(409,"Another recording request is active");
  const existing=await tx.select().from(recordings).where(and(eq(recordings.account,account),ne(recordings.status,"deleted")));
  const active=existing.filter(r=>activeRecordingStates.includes(r.status));
  if(existing.length>=5||active.length>=2||active.some(r=>r.computerId===computerId))throw new ApiError(409,"Recording quota exceeded");
  const [r]=await tx.insert(recordings).values({id,account,computerId,instanceUid,status:"queued",maxSeconds:spec.maxSeconds,consentAt:new Date()}).returning();
  return publicRecord(r);
 });
}
function whereRecording(account:string,computerId:string,id:string){
 recordingPath(id);
 return and(eq(recordings.account,account),eq(recordings.computerId,computerId),eq(recordings.id,id));
}
async function getRow(account:string,computerId:string,id:string){
 const [r]=await database().select().from(recordings).where(whereRecording(account,computerId,id));
 if(!r||r.status==="deleted")throw new ApiError(404,"Recording not found");
 return r;
}
export async function recordingStatus(account:string,computerId:string,id:string){return publicRecord(await getRow(account,computerId,id))}
export async function listRecordings(account:string,computerId:string){
 if(!/^vm-[a-f0-9]{32}$/.test(computerId))throw new ApiError(404,"Computer not found");
 const rows=await database().select().from(recordings).where(and(eq(recordings.account,account),eq(recordings.computerId,computerId),ne(recordings.status,"deleted"))).orderBy(recordings.createdAt);
 return rows.map(publicRecord);
}
export async function stopRecording(account:string,computerId:string,id:string){
 return database().transaction(async tx=>{
  const where=whereRecording(account,computerId,id);
  const [r]=await tx.select().from(recordings).where(where).for("update");
  if(!r||r.status==="deleted")throw new ApiError(404,"Recording not found");
  if(!activeRecordingStates.includes(r.status))return publicRecord(r);
  if(r.status==="queued"){
   const [done]=await tx.update(recordings).set({status:"failed",stopRequestedAt:new Date(),finishedAt:new Date(),error:"Stopped before capture began"}).where(where).returning();
   return publicRecord(done);
  }
  const [updated]=await tx.update(recordings).set({status:"stopping",stopRequestedAt:r.stopRequestedAt??new Date()}).where(where).returning();
  return publicRecord(updated);
 });
}
export async function recordingFile(account:string,computerId:string,id:string){
 const r=await getRow(account,computerId,id);
 if(r.status!=="completed"||!r.bytes||r.bytes>RECORDING_MAX_BYTES||!r.sha256)throw new ApiError(409,"Recording file not available");
 const fd=await open(recordingPath(id),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await fd.stat();
  if(!stat.isFile()||stat.size!==r.bytes)throw new ApiError(502,"Recording artifact is unavailable");
  const stream=fd.createReadStream({autoClose:true});
  return {body:Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,size:r.bytes,sha256:r.sha256};
 }catch(e){await fd.close();throw e}
}
export async function deleteRecording(account:string,computerId:string,id:string){
 return database().transaction(async tx=>{
  const where=whereRecording(account,computerId,id);
  const [r]=await tx.select().from(recordings).where(where).for("update");
  if(!r)throw new ApiError(404,"Recording not found");
  if(activeRecordingStates.includes(r.status))throw new ApiError(409,"Stop recording before deletion");
  if(r.status==="deleted")return {id,status:"deleted"};
  try{await unlink(recordingPath(id))}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e}
  await tx.update(recordings).set({status:"deleted",bytes:null,sha256:null}).where(where);
  return {id,status:"deleted"};
 });
}
// The worker uses this state fence; stale workers never publish an artifact.
export function recordingFence(id:string,workerId:string){
 return and(eq(recordings.id,id),eq(recordings.workerId,workerId),inArray(recordings.status,["recording","stopping"]));
}
