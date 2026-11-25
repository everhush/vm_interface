import {createHash,randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {open,statfs,unlink} from "node:fs/promises";
import {join} from "node:path";
import {and,eq,lt,sql} from "drizzle-orm";
import {database,mediaStages} from "./db";
import {ApiError} from "./kube";
import {mediaChunkBytes,stageMaxBytes,MiB} from "./media-config";
import {withVmLock} from "./hardware";
export const stageDir="/var/lib/vm-media-stage";
export const directMaxBytes=64*MiB;
export const stageExpiryMs=24*60*60*1000;
type Row=typeof mediaStages.$inferSelect;
export type StageTarget={computerId:string;account:string;slot:"boot"|"installer"|"auxiliary"|`data-${string}`;dvUid:string;sha256:string;bytes:number};
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
function stagePath(row:Row){
 if(!/^[0-9a-f-]{36}$/.test(row.stageId))throw new ApiError(409,"Invalid persisted stage identity");
 return join(stageDir,row.stageId+".resume");
}
function matches(row:Row,t:StageTarget){
 return row.account===t.account&&row.computerId===t.computerId&&row.slot===t.slot&&row.dvUid===t.dvUid&&row.sha256===t.sha256&&row.bytes===t.bytes;
}
export function chunkLength(total:number,offset:number){
 if(!Number.isSafeInteger(total)||total<=0||!Number.isSafeInteger(offset)||offset<0||offset>=total||offset%mediaChunkBytes!==0)throw new ApiError(422,"Invalid chunk offset");
 return Math.min(mediaChunkBytes,total-offset);
}
export function validateChunk(total:number,offset:number,bytes:Buffer,sha256:string){
 if(bytes.length!==chunkLength(total,offset)||! /^[a-f0-9]{64}$/.test(sha256)||digest(bytes)!==sha256)throw new ApiError(422,"Chunk length or SHA256 mismatch");
}
let reads=0;
export async function readChunk(body:ReadableStream<Uint8Array>,expected:number){
 if(expected<1||expected>mediaChunkBytes)throw new ApiError(422,"Invalid chunk length");
 if(reads>=2)throw new ApiError(409,"Chunk receiver busy");
 const reader=body.getReader(),chunks:Buffer[]=[];
 reads++;let size=0;
 const deadline=Date.now()+30000,timer=setTimeout(()=>void reader.cancel().catch(()=>{}),30000);
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.length;if(size>expected)throw new ApiError(413,"Chunk exceeds expected length");
   chunks.push(Buffer.from(value));
  }
  if(Date.now()>=deadline||size!==expected)throw new ApiError(422,"Chunk incomplete or deadline exceeded");
  return Buffer.concat(chunks,size);
 }catch(e){await reader.cancel().catch(()=>{});throw e}
 finally{clearTimeout(timer);reader.releaseLock();reads--}
}
export async function stageProgress(t:StageTarget){
 const [row]=await database().select().from(mediaStages).where(eq(mediaStages.computerId,t.computerId));
 return row&&matches(row,t)?row.received:0;
}
async function reserve(t:StageTarget,offset:number){
 return database().transaction(async tx=>{
  const locks=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('vm-interface:media-stage',0)) AS locked`);
  if(locks[0]?.locked!==true)throw new ApiError(409,"Stage reservation busy");
  const [existing]=await tx.select().from(mediaStages).where(eq(mediaStages.computerId,t.computerId));
  if(existing){if(!matches(existing,t))throw new ApiError(409,"Stage belongs to a different media declaration; discard it explicitly");return existing}
  if(offset!==0)throw new ApiError(409,"Expected upload offset 0");
  const all=await tx.select({bytes:mediaStages.bytes,received:mediaStages.received}).from(mediaStages).limit(65);
  const reserved=all.reduce((n,row)=>n+row.bytes,0);
  // Reserve space for the two bounded direct-upload receivers too.
  if(all.length>=64||reserved+t.bytes+2*directMaxBytes>stageMaxBytes)throw new ApiError(409,"Media stage quota exceeded");
  const fs=await statfs(stageDir);
  const outstanding=all.reduce((n,row)=>n+row.bytes-row.received,0);
  if(fs.bavail*fs.bsize<outstanding+t.bytes+2*directMaxBytes+64*MiB)throw new ApiError(409,"Insufficient physical staging space");
  const [row]=await tx.insert(mediaStages).values({...t,stageId:randomUUID(),received:0}).returning();
  return row;
 });
}
async function openStage(row:Row){
 const fd=await open(stagePath(row),constants.O_RDWR|constants.O_NOFOLLOW|(row.received===0?constants.O_CREAT:0),0o600);
 try{
  const s=await fd.stat();
  if(!s.isFile()||s.nlink!==1||s.size<row.received)throw new ApiError(409,"Stage file is missing committed bytes; discard it");
  // A crash between file fsync and DB offset commit leaves an uncommitted
  // tail. It must never be counted as accepted data.
  if(s.size>row.received){await fd.truncate(row.received);await fd.sync()}
  return fd;
 }catch(e){await fd.close();throw e}
}
/** Caller holds per-VM lock across validation, file write and DB offset CAS. */
export async function appendStage(t:StageTarget,offset:number,bytes:Buffer,sha256:string){
 validateChunk(t.bytes,offset,bytes,sha256);
 const row=await reserve(t,offset);
 if(offset>row.received)throw new ApiError(409,"Expected upload offset "+row.received);
 const fd=await openStage(row);
 try{
  if(offset<row.received){
   if(offset+bytes.length>row.received)throw new ApiError(409,"Chunk overlaps uncommitted data");
   const old=Buffer.alloc(bytes.length);let read=0;
   while(read<old.length){const n=await fd.read(old,read,old.length-read,offset+read);if(!n.bytesRead)throw new ApiError(409,"Committed stage is incomplete");read+=n.bytesRead}
   if(digest(old)!==sha256)throw new ApiError(409,"Chunk conflicts with committed bytes");
   await database().update(mediaStages).set({updatedAt:new Date()}).where(eq(mediaStages.stageId,row.stageId));
   return {received:row.received,total:row.bytes,replayed:true};
  }
  let written=0;
  while(written<bytes.length){const n=await fd.write(bytes,written,bytes.length-written,offset+written);if(!n.bytesWritten)throw new ApiError(502,"Stage write failed");written+=n.bytesWritten}
  await fd.sync();
  if(row.received===0){const dir=await open(stageDir,"r");try{await dir.sync()}finally{await dir.close()}}
  const [changed]=await database().update(mediaStages).set({received:offset+bytes.length,updatedAt:new Date()}).where(and(eq(mediaStages.stageId,row.stageId),eq(mediaStages.received,row.received))).returning({received:mediaStages.received});
  if(!changed)throw new ApiError(409,"Stage offset changed; inspect progress");
  return {received:changed.received,total:row.bytes,replayed:false};
 }finally{await fd.close()}
}
export async function verifiedStage(t:StageTarget,validHeader:(head:Buffer)=>boolean){
 const [row]=await database().select().from(mediaStages).where(eq(mediaStages.computerId,t.computerId));
 if(!row||!matches(row,t)||row.received!==row.bytes)throw new ApiError(409,"Complete matching media stage required");
 const fd=await openStage(row);
 const path=stagePath(row),hash=createHash("sha256");let count=0,head=Buffer.alloc(0);
 try{for await(const bytes of fd.createReadStream({autoClose:false,start:0})){
  const chunk=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  count+=chunk.length;if(count>t.bytes)throw new ApiError(422,"Stage length changed");
  if(head.length<65536)head=Buffer.concat([head,chunk.subarray(0,65536-head.length)]);
  hash.update(chunk);
 }}finally{await fd.close()}
 if(count!==t.bytes||hash.digest("hex")!==t.sha256||!validHeader(head))throw new ApiError(422,"Complete media length, SHA256 or format mismatch");
 await database().update(mediaStages).set({updatedAt:new Date()}).where(eq(mediaStages.stageId,row.stageId));
 return {path,row};
}
async function remove(row:Row){
 await unlink(stagePath(row)).catch((e:NodeJS.ErrnoException)=>{if(e.code!=="ENOENT")throw e});
 await database().delete(mediaStages).where(eq(mediaStages.stageId,row.stageId));
}
export async function discardStage(computerId:string,account:string,slot:string){
 const [row]=await database().select().from(mediaStages).where(and(eq(mediaStages.computerId,computerId),eq(mediaStages.account,account),eq(mediaStages.slot,slot)));
 if(row)await remove(row);
 return {discarded:!!row};
}
export async function reapMediaStages(){
 const expiry=new Date(Date.now()-stageExpiryMs);
 const stale=await database().select().from(mediaStages).where(lt(mediaStages.updatedAt,expiry)).limit(8);
 for(const row of stale){
  try{await withVmLock(row.computerId,async()=>{
   const [latest]=await database().select().from(mediaStages).where(and(eq(mediaStages.stageId,row.stageId),lt(mediaStages.updatedAt,expiry)));
   if(latest)await remove(latest);
  })}catch{/* active or unavailable; retry later */}
 }
}
