import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {open,unlink,statfs} from "node:fs/promises";
import {request} from "node:https";
import {join} from "node:path";
import {and,eq} from "drizzle-orm";
import {database,mediaTransfers} from "./db";
import {ApiError,kube,owned,dvPath,pvcPath,vmiPath,type Resource} from "./kube";
import {mediaSpec,diskNames} from "./spec";
import {hasOwner,managedDisks} from "./storage";
import type {z} from "zod";
type Metadata=z.infer<typeof mediaSpec>;
export type Slot="boot"|"installer"|"auxiliary";
const ns=()=>process.env.VM_NAMESPACE||"vm-interface";
import {stageDir,directMaxBytes,stageProgress,appendStage,verifiedStage,discardStage,type StageTarget} from "./media-resume";
import {mediaChunkBytes,MiB} from "./media-config";
let inFlight=0;
export function mediaDeclaration(vm:Resource,id:string,requested?:Slot){
 const annotations=(vm.spec as {template?:{metadata?:{annotations?:Record<string,string>}}})?.template?.metadata?.annotations;
 const primary=annotations?.["vm-interface.io/media-slot"];
 const slot=requested??primary;
 if(requested&&requested!=="auxiliary"&&requested!==primary)return null;
 const raw=annotations?.[slot==="auxiliary"?"vm-interface.io/auxiliary-media":"vm-interface.io/media"];
 if(!raw&&(requested==="auxiliary"||!slot))return null;
 if(!raw||(slot!=="boot"&&slot!=="installer"&&slot!=="auxiliary"))throw new ApiError(409,"Invalid stored media declaration");
 let value:unknown;try{value=JSON.parse(raw)}catch{throw new ApiError(409,"Invalid stored media declaration")}
 const parsed=mediaSpec.safeParse(value);
 if(!parsed.success)throw new ApiError(409,"Invalid stored media declaration");
 const name=slot==="boot"?diskNames(id).boot:id+"-"+slot;
 if(!managedDisks(vm,id).some(d=>d.name===name&&d.kind===slot))throw new ApiError(409,"Invalid media storage layout");
 return {slot:slot as Slot,name,metadata:parsed.data};
}
async function optional(path:string){
 try{return await kube("GET",path) as Resource}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
async function target(id:string,account:string,slot?:Slot){
 const vm=await owned(id,account),decl=mediaDeclaration(vm,id,slot);
 if(!decl)return null;
 const dv=await optional(dvPath(decl.name)),pvc=await optional(pvcPath(decl.name));
 if(dv&&(!hasOwner(dv,"VirtualMachine",vm.metadata?.uid)||!(dv.spec as {source?:{upload?:object}})?.source?.upload))throw new ApiError(409,"Media DataVolume ownership or source mismatch");
 if(pvc&&!hasOwner(pvc,"DataVolume",dv?.metadata?.uid)&&!hasOwner(pvc,"VirtualMachine",vm.metadata?.uid))throw new ApiError(409,"Media PVC ownership mismatch");
 const phase=(dv?.status as {phase?:string}|undefined)?.phase??null;
 const [record]=await database().select().from(mediaTransfers).where(and(eq(mediaTransfers.account,account),eq(mediaTransfers.computerId,id),eq(mediaTransfers.slot,decl.slot)));
 const verified=!!record&&record.dvUid===dv?.metadata?.uid&&record.sha256===decl.metadata.sha256&&record.bytes===decl.metadata.bytes&&["sending","transmitted"].includes(record.state);
 return {...decl,vm,dv,pvc,phase,verified,ready:phase==="Succeeded"&&verified};
}
export async function mediaStatus(id:string,account:string,slot?:Slot){
 const t=await target(id,account,slot);
 if(!t)return null;
 const st=stageTarget(id,account,t);
 return {slot:t.slot,metadata:t.metadata,phase:t.phase,verifiedInput:t.verified,ready:t.ready,stagedBytes:st?await stageProgress(st):0,chunkBytes:mediaChunkBytes,directMaxBytes};
}
export async function requireMediaReady(id:string,account:string){
 for(const slot of [undefined,"auxiliary"] as const){
  const state=await mediaStatus(id,account,slot);
  if(state&&!state.ready)throw new ApiError(409,"Declared media is not verified and imported");
 }
}
export function validMediaHeader(format:Metadata["format"],header:Buffer):boolean{
 if(format==="qcow2"){
  if(header.length<72||header.readUInt32BE(0)!==0x514649fb)return false;
  const version=header.readUInt32BE(4);
  // Reject backing chains, encryption and external data before CDI sees bytes.
  if(![2,3].includes(version)||header.readBigUInt64BE(8)!==0n||header.readUInt32BE(16)!==0||header.readUInt32BE(32)!==0)return false;
  if(version===3&&(header.length<104||(header.readBigUInt64BE(72)&4n)!==0n))return false;
  return true;
 }
 if(format==="iso"){
  for(let sector=16;sector<32;sector++)if(header.subarray(sector*2048+1,sector*2048+6).toString("ascii")==="CD001")return true;
  return false;
 }
 // Raw disk is not universally bootable. Reject obvious QCOW2 and ISO headers.
 return header.length>=512&&header.readUInt32BE(0)!==0x514649fb&&!validMediaHeader("iso",header);
}
async function stage(body:ReadableStream<Uint8Array>,path:string,metadata:Metadata){
 const fd=await open(path,"wx",0o600),reader=body.getReader();
 const hash=createHash("sha256");let size=0,head=Buffer.alloc(0);
 const deadline=Date.now()+180000;
 const timer=setTimeout(()=>void reader.cancel().catch(()=>{}),180000);
 try{
  while(true){
   if(Date.now()>deadline)throw new ApiError(422,"Upload deadline exceeded");
   const {done,value}=await reader.read();if(done)break;
   const bytes=Buffer.from(value);size+=bytes.length;
   if(size>metadata.bytes)throw new ApiError(413,"Media exceeds declared length");
   if(head.length<65536)head=Buffer.concat([head,bytes.subarray(0,65536-head.length)]);
   hash.update(bytes);
   let off=0;while(off<bytes.length){const w=await fd.write(bytes,off,bytes.length-off);if(!w.bytesWritten)throw new ApiError(502,"Stage write failed");off+=w.bytesWritten}
  }
  if(Date.now()>deadline||size!==metadata.bytes||hash.digest("hex")!==metadata.sha256)throw new ApiError(422,"Media byte length or SHA256 mismatch");
  if(!validMediaHeader(metadata.format,head))throw new ApiError(422,"Declared media format does not match bytes");
  await fd.sync();
 }catch(e){await reader.cancel().catch(()=>{});throw e}
 finally{clearTimeout(timer);reader.releaseLock();await fd.close()}
}
async function transmit(path:string,size:number,token:string,ca:string){
 return new Promise<void>((resolve,reject)=>{
  const req=request({hostname:"cdi-uploadproxy.cdi.svc",port:443,path:"/v1beta1/upload-async",method:"POST",ca,headers:{authorization:"Bearer "+token,"content-type":"application/octet-stream","content-length":size},timeout:30000},res=>{
   res.resume();res.on("error",reject);res.on("end",()=>res.statusCode&&res.statusCode>=200&&res.statusCode<300?resolve():reject(new ApiError(502,"CDI upload rejected ("+res.statusCode+")")));
  });
  const source=createReadStream(path);
  const timer=setTimeout(()=>req.destroy(new ApiError(502,"CDI upload deadline exceeded")),Math.min(30*60*1000,Math.max(180000,Math.ceil(size/MiB)*1000)));
  req.on("close",()=>{clearTimeout(timer);source.destroy()});
  req.on("timeout",()=>req.destroy(new ApiError(502,"CDI upload timed out")));
  req.on("error",reject);source.on("error",e=>req.destroy(e));
  source.pipe(req);
 });
}
type Target=NonNullable<Awaited<ReturnType<typeof target>>>;
function stageTarget(id:string,account:string,t:Target):StageTarget|null{
 const dvUid=t.dv?.metadata?.uid;
 return dvUid?{computerId:id,account,slot:t.slot,dvUid,sha256:t.metadata.sha256,bytes:t.metadata.bytes}:null;
}
async function uploadTarget(id:string,account:string,slot:Slot){
 const t=await target(id,account,slot);
 if(!t||t.slot!==slot)throw new ApiError(404,"Media slot not found");
 if(t.ready)return t;
 if(t.phase!=="UploadReady"||!t.dv?.metadata?.uid||!t.pvc?.metadata?.uid)throw new ApiError(409,"CDI upload target is not ready");
 if(await optional(vmiPath(id)))throw new ApiError(409,"Stop VM before media upload");
 return t;
}
async function sendVerified(id:string,account:string,slot:Slot,t:Target,path:string,opId:string){
 const dvUid=t.dv?.metadata?.uid;
 const current=await target(id,account,slot);
 if(!dvUid||!current||current.phase!=="UploadReady"||current.dv?.metadata?.uid!==dvUid||current.pvc?.metadata?.uid!==t.pvc?.metadata?.uid)throw new ApiError(409,"Media target changed");
 const tokenResponse=await kube("POST","/apis/upload.cdi.kubevirt.io/v1beta1/namespaces/"+ns()+"/uploadtokenrequests",{apiVersion:"upload.cdi.kubevirt.io/v1beta1",kind:"UploadTokenRequest",metadata:{name:t.name},spec:{pvcName:t.name}}) as {status?:{token?:string}};
 const token=tokenResponse.status?.token;
 if(!token||token.length>8192)throw new ApiError(502,"CDI did not issue upload token");
 const config=await kube("GET","/api/v1/namespaces/cdi/configmaps/cdi-uploadproxy-signer-bundle") as {data?:Record<string,string>};
 const ca=config.data?.["ca-bundle.crt"];
 if(!ca?.includes("BEGIN CERTIFICATE"))throw new ApiError(502,"CDI upload CA unavailable");
 const values={computerId:id,account,slot,dvUid,operationId:opId,sha256:t.metadata.sha256,bytes:t.metadata.bytes,state:"sending",updatedAt:new Date()};
 await database().insert(mediaTransfers).values(values).onConflictDoUpdate({target:[mediaTransfers.computerId,mediaTransfers.slot],set:values});
 await transmit(path,t.metadata.bytes,token,ca);
 await database().update(mediaTransfers).set({state:"transmitted",updatedAt:new Date()}).where(and(eq(mediaTransfers.computerId,id),eq(mediaTransfers.slot,slot),eq(mediaTransfers.operationId,opId)));
 return {slot,sha256:t.metadata.sha256,bytes:t.metadata.bytes,phase:"submitted"};
}
export async function uploadMedia(id:string,account:string,slot:Slot,body:ReadableStream<Uint8Array>,opId:string){
 if(!/^[0-9a-f-]{36}$/.test(opId))throw new ApiError(400,"Invalid operation ID");
 if(inFlight>=2)throw new ApiError(409,"Media staging busy");
 inFlight++;
 const path=join(stageDir,opId+".part");
 try{
  const t=await uploadTarget(id,account,slot);
  if(t.ready)return {slot,sha256:t.metadata.sha256,bytes:t.metadata.bytes,phase:t.phase,alreadyImported:true};
  if(t.metadata.bytes>directMaxBytes)throw new ApiError(413,"Use resumable chunk upload for large media");
  const fs=await statfs(stageDir);
  if(fs.bavail*fs.bsize<t.metadata.bytes+64*MiB)throw new ApiError(409,"Insufficient physical staging space");
  await stage(body,path,t.metadata);
  return await sendVerified(id,account,slot,t,path,opId);
 }finally{await unlink(path).catch(()=>{});inFlight--}
}
export async function uploadMediaChunk(id:string,account:string,slot:Slot,offset:number,bytes:Buffer,sha256:string){
 const t=await uploadTarget(id,account,slot);
 if(t.ready)throw new ApiError(409,"Media already imported");
 const st=stageTarget(id,account,t);
 if(!st)throw new ApiError(409,"Media target identity unavailable");
 return appendStage(st,offset,bytes,sha256);
}
export async function commitMediaStage(id:string,account:string,slot:Slot,opId:string){
 if(inFlight>=2)throw new ApiError(409,"Media staging busy");
 inFlight++;
 try{
  const t=await uploadTarget(id,account,slot);
  if(t.ready){await discardStage(id,account,slot);return {slot,sha256:t.metadata.sha256,bytes:t.metadata.bytes,phase:t.phase,alreadyImported:true}}
  const st=stageTarget(id,account,t);
  if(!st)throw new ApiError(409,"Media target identity unavailable");
  const verified=await verifiedStage(st,head=>validMediaHeader(t.metadata.format,head));
  const result=await sendVerified(id,account,slot,t,verified.path,opId);
  // Successful submission means CDI has accepted the bytes. If the response
  // is lost, preserve the stage for explicit inspection; never auto-replay.
  await discardStage(id,account,slot);
  return result;
 }finally{inFlight--}
}
