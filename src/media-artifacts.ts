import {z} from "zod";
import {and,eq,sql} from "drizzle-orm";
import {createHash} from "node:crypto";
import {constants,createReadStream} from "node:fs";
import {link,open,statfs,unlink} from "node:fs/promises";
import {join} from "node:path";
import {Readable} from "node:stream";
import {database,mediaArtifacts} from "./db";
import {ApiError,owned} from "./kube";
import {mediaSpec} from "./spec";
import {mediaDeclaration,stageVerifiedMedia,uploadMedia,validMediaHeader,type Slot} from "./media";
import {MiB} from "./media-config";

const root="/var/lib/vm-media-artifacts";
const maxBytes=64*MiB,accountBytes=256*MiB,globalBytes=512*MiB;
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const artifactSpec=z.strictObject({
 metadata:mediaSpec,
 architecture:z.enum(["amd64","arm64"]),
 licensing:z.string().min(1).max(256)
}).superRefine((s,ctx)=>{if(s.metadata.bytes>maxBytes)ctx.addIssue({code:"custom",path:["metadata","bytes"],message:"Registered image exceeds direct artifact limit"})});
export const artifactReference=z.strictObject({artifactId:z.string().regex(idPattern)});
export type ArtifactSpec=z.infer<typeof artifactSpec>;
type Row=typeof mediaArtifacts.$inferSelect;
export const artifactLimits={maxBytes,accountBytes,globalBytes,accountCount:8,globalCount:32};

function validId(id:string){if(!idPattern.test(id))throw new ApiError(404,"Media artifact not found")}
function pathFor(id:string,suffix:".img"|".part"){validId(id);return join(root,id+suffix)}
function view(row:Row){
 const spec=artifactSpec.safeParse(row.spec);
 if(!spec.success||spec.data.metadata.bytes!==row.bytes||!["registered","verified"].includes(row.state))throw new ApiError(409,"Invalid persisted artifact declaration");
 return {id:row.id,...spec.data,state:row.state,createdAt:row.createdAt};
}
export function artifactCapacity(rows:{account:string;bytes:number}[],account:string,bytes:number){
 const mine=rows.filter(x=>x.account===account);
 if(!Number.isSafeInteger(bytes)||bytes<512||bytes>maxBytes||rows.length>=artifactLimits.globalCount||mine.length>=artifactLimits.accountCount||rows.reduce((n,x)=>n+x.bytes,0)+bytes>globalBytes||mine.reduce((n,x)=>n+x.bytes,0)+bytes>accountBytes)throw new ApiError(409,"Registered image artifact quota exceeded");
}
export function artifactMatches(s:ArtifactSpec,metadata:unknown,architecture:unknown){
 const m=mediaSpec.safeParse(metadata);
 return m.success&&s.architecture===architecture&&Object.keys(s.metadata).length===Object.keys(m.data).length&&Object.entries(s.metadata).every(([k,v])=>m.data[k as keyof typeof m.data]===v);
}
async function row(account:string,id:string){
 validId(id);
 const [v]=await database().select().from(mediaArtifacts).where(and(eq(mediaArtifacts.account,account),eq(mediaArtifacts.id,id)));
 if(!v)throw new ApiError(404,"Media artifact not found");
 return v;
}
async function lock<T>(id:string,run:()=>Promise<T>){
 validId(id);
 return database().transaction(async tx=>{
  const rows=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:media-artifact:"+id},0)) AS locked`);
  if(rows[0]?.locked!==true)throw new ApiError(409,"Media artifact is busy; inspect state before retry");
  return run();
 });
}
export async function registerArtifact(account:string,id:string,s:ArtifactSpec){
 validId(id);
 return database().transaction(async tx=>{
  const l=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('vm-interface:media-artifact-reservations',0)) AS locked`);
  if(l[0]?.locked!==true)throw new ApiError(409,"Artifact reservation busy");
  const reservations=await tx.select({account:mediaArtifacts.account,bytes:mediaArtifacts.bytes}).from(mediaArtifacts).limit(33);
  artifactCapacity(reservations,account,s.metadata.bytes);
  const fs=await statfs(root);
  if(fs.bavail*fs.bsize<s.metadata.bytes+64*MiB)throw new ApiError(409,"Insufficient artifact storage");
  const [created]=await tx.insert(mediaArtifacts).values({id,account,spec:s,bytes:s.metadata.bytes,state:"registered"}).returning();
  return view(created);
 });
}
export async function listArtifacts(account:string){
 const rows=await database().select().from(mediaArtifacts).where(eq(mediaArtifacts.account,account)).limit(artifactLimits.accountCount);
 return {limits:artifactLimits,usage:{count:rows.length,bytes:rows.reduce((n,x)=>n+x.bytes,0)},artifacts:rows.map(view)};
}
export async function artifactStatus(account:string,id:string){return view(await row(account,id))}
async function remove(path:string){try{await unlink(path)}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e}}
async function fsyncDir(){const fd=await open(root,"r");try{await fd.sync()}finally{await fd.close()}}
async function verifyPublished(id:string,s:ArtifactSpec){
 const fd=await open(pathFor(id,".img"),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||st.size!==s.metadata.bytes)throw new ApiError(409,"Registered image file is invalid");
  const hash=createHash("sha256"),buf=Buffer.alloc(MiB);let read=0,head=Buffer.alloc(0);
  while(read<st.size){
   const n=await fd.read(buf,0,Math.min(buf.length,st.size-read),read);
   if(!n.bytesRead)throw new ApiError(409,"Registered image file is incomplete");
   const b=buf.subarray(0,n.bytesRead);hash.update(b);
   if(head.length<65536)head=Buffer.concat([head,b.subarray(0,65536-head.length)]);
   read+=n.bytesRead;
  }
  if(hash.digest("hex")!==s.metadata.sha256||!validMediaHeader(s.metadata.format,head))throw new ApiError(409,"Registered image integrity check failed");
 }finally{await fd.close()}
}
export async function putArtifact(account:string,id:string,body:ReadableStream<Uint8Array>){
 return lock(id,async()=>{
  const v=view(await row(account,id));
  if(v.state==="verified")throw new ApiError(409,"Registered image is immutable");
  const final=pathFor(id,".img"),part=pathFor(id,".part");
  // Explicit recovery after interruption: a published file is verified, never
  // overwritten. A leftover partial file has no verified state.
  let published=false;
  try{await verifyPublished(id,v);published=true}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e}
  // Crash after link but before removing the temporary hardlink is recoverable
  // only by explicit discard/delete; do not silently trust unexpected links.
  if(!published){
   const fs=await statfs(root);
   if(fs.bavail*fs.bsize<v.metadata.bytes+64*MiB)throw new ApiError(409,"Insufficient artifact storage");
   await remove(part);
   try{
    await stageVerifiedMedia(body,part,v.metadata,64*1024**3);
    await link(part,final);
    await remove(part);
    await fsyncDir();
   }finally{await remove(part)}
  }
  const [updated]=await database().update(mediaArtifacts).set({state:"verified"}).where(and(eq(mediaArtifacts.account,account),eq(mediaArtifacts.id,id),eq(mediaArtifacts.state,"registered"))).returning();
  if(!updated)throw new ApiError(409,"Artifact reservation changed");
  return view(updated);
 });
}
export async function deleteArtifact(account:string,id:string){
 return lock(id,async()=>{
  await row(account,id);
  await remove(pathFor(id,".img"));await remove(pathFor(id,".part"));await fsyncDir();
  await database().delete(mediaArtifacts).where(and(eq(mediaArtifacts.account,account),eq(mediaArtifacts.id,id)));
  return {id,deleted:true};
 });
}
/** Caller holds VM mutation lock. No artifact operation acquires a VM lock. */
export async function importArtifact(account:string,id:string,slot:Slot,artifactId:string,opId:string){
 return lock(artifactId,async()=>{
  const artifact=view(await row(account,artifactId));
  const vm=await owned(id,account),decl=mediaDeclaration(vm,id,slot);
  const architecture=(vm.spec as {template?:{spec?:{architecture?:string}}})?.template?.spec?.architecture;
  if(!decl||decl.slot!==slot)throw new ApiError(404,"Media slot not found");
  if(artifact.state!=="verified"||!artifactMatches(artifact,decl.metadata,architecture))throw new ApiError(409,"Registered artifact is not verified or differs from target declaration");
  await verifyPublished(artifactId,artifact);
  const source=createReadStream(pathFor(artifactId,".img"),{flags:constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK});
  try{
   // uploadMedia rechecks exact byte count, SHA, media header, actual VM disk
   // reservation, target CDI/PVC identity and cold lifecycle before transmission.
   return await uploadMedia(id,account,slot,Readable.toWeb(source) as ReadableStream<Uint8Array>,opId);
  }finally{source.destroy()}
 });
}
