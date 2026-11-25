import {authenticate,keySpec,requirePermission,issueKey,listKeys,revokeKey,rotateKey} from "../../../../src/account-keys";
import {computerSpec,schema,vmManifest} from "../../../../src/spec";
import {catalog} from "../../../../src/catalog";
import {ApiError,kube,vmPath,vmiPath,actionPath,owned,list,type Resource} from "../../../../src/kube";
import {mutate,operation} from "../../../../src/operation";
import {migrate} from "../../../../src/db";
import {openApiDocument} from "../../../../src/openapi";
import {inspectStorage,managedDisks,requireDeleteConfirmation} from "../../../../src/storage";
import {hardwareSpec,configureHardware,withVmLock} from "../../../../src/hardware";
import {guestObservation} from "../../../../src/guest";
import {screenshot} from "../../../../src/screenshot";
import {displayToken,issueDisplayTicket,lookupDisplayTicket,listDisplayTickets,revokeDisplayTicket} from "../../../../src/console-tickets";
import {acquireInput,releaseInput,inputStatus} from "../../../../src/input-lease";
import {recordingSpec,startRecording,stopRecording,recordingStatus,listRecordings,recordingFile,deleteRecording} from "../../../../src/recordings";
import {quota,requireAccountCapacity,specUsage,withAccountLock} from "../../../../src/quota";
import {batchSpec,dispatchBatch} from "../../../../src/input-batch";
import {ensureExchange,exchangeRequest,exchangeFileName,exchangeConfigured} from "../../../../src/exchange";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
const imageResponse=(png:Buffer)=>new Response(Uint8Array.from(png),{headers:{"content-type":"image/png","cache-control":"no-store","x-content-type-options":"nosniff","content-disposition":"inline; filename=\"screenshot.png\""}});
const capabilities={phase:"console and storage development",verified:["native amd64 KVM lifecycle, account isolation, cold CPU/RAM, CDI/PVC identities, desired-resource quotas, authenticated PNG display capture (CI 45542879476)","hashed account keys, scoped display tickets, pinned image CDI, shared read-only RFB (CI 45544070366)"],implementedUnverified:["durable input lease and server-side input gating","explicit-consent sampled MP4 recording and retrieval","bounded lease-fenced HTTP input batches","VirtioFS profile and bounded account-scoped file bytes"],conditional:["arm64 (free standard runners lack /dev/kvm)","VirtioFS (native guest mount and byte roundtrip verified; product file API pending)","virtio-mem (driver present on Fedora; live resize not certified)"],unsupported:["arbitrary media import","network exposure","hotplug","snapshots","migration","GPU"]};
async function handle(req:Request){
 try{
  const p=new URL(req.url).pathname.split("/").filter(Boolean).slice(2), m=req.method;
  if(m==="GET"&&p.join("/")==="health"){await migrate();await kube("GET",vmPath()+"?limit=1");return json({ready:true});}
  const authorization=req.headers.get("authorization");
  const ticket=displayToken(authorization);
  if(ticket&&m==="GET"&&p[0]==="computers"&&p.length===3&&p[2]==="screenshot"){
   const grant=await lookupDisplayTicket(ticket,p[1]);
   const png=await screenshot(p[1],grant.account,grant.instanceUid);
   // Do not return captured bytes after revocation or expiry during capture.
   await lookupDisplayTicket(ticket,p[1]);
   return imageResponse(png);
  }
  if(ticket&&p[0]==="computers"&&p.length===3&&p[2]==="input-lease"){
   if(m==="POST"){
    const raw=await req.text();if(raw.length>256)throw new ApiError(413,"Lease request too large");
    let take=false;
    if(raw.length){
     let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
     if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>k!=="takeover")||("takeover" in input&&typeof input.takeover!=="boolean"))throw new ApiError(422,"Invalid input lease request");
     take="takeover" in input&&input.takeover===true;
    }
    return json(await acquireInput(ticket,p[1],take));
   }
   if(m==="DELETE")return json(await releaseInput(ticket,p[1]));
  }
  if(ticket&&m==="POST"&&p[0]==="computers"&&p.length===3&&p[2]==="input"){
   const grant=await lookupDisplayTicket(ticket,p[1]);
   if(grant.scope!=="control-vnc")throw new ApiError(403,"Control ticket required");
   const reader=req.body?.getReader();if(!reader)throw new ApiError(400,"Missing input events");
   let size=0;const chunks:Buffer[]=[];
   try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>16384){await reader.cancel();throw new ApiError(413,"Input batch too large")}chunks.push(Buffer.from(next.value))}}finally{reader.releaseLock()}
   let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{throw new ApiError(400,"Invalid JSON")}
   const parsed=batchSpec.safeParse(raw);if(!parsed.success)throw new ApiError(422,"Invalid input batch");
   return json(await mutate(grant.account,req.headers.get("idempotency-key"),{action:"input",id:p[1],ticketId:grant.id,batch:parsed.data},()=>dispatchBatch(p[1],ticket,parsed.data)),202);
  }
  const identity=await authenticate(authorization);
  if(!identity)return json({error:"Unauthorized"},401);
  const account=identity.account;
  requirePermission(identity,m,p[0]==="keys");
  if(p[0]==="keys"){
   if(m==="GET"&&p.length===1)return json(await listKeys(account));
   if(m==="POST"&&p.length===1){
    const raw=await req.text();if(raw.length>4096)throw new ApiError(413,"Key specification too large");
    let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
    const parsed=keySpec.safeParse(input);if(!parsed.success)throw new ApiError(422,"Invalid account key specification");
    return json(await issueKey(account,parsed.data),201);
   }
   if(m==="DELETE"&&p.length===2)return json(await revokeKey(account,p[1]));
   if(m==="POST"&&p.length===3&&p[2]==="rotate")return json(await rotateKey(account,p[1]),201);
   throw new ApiError(404,"Not found");
  }
  if(m==="GET"&&p.join("/")==="schema")return json(schema);
  if(m==="GET"&&p.join("/")==="images")return json(catalog);
  if(m==="GET"&&p.join("/")==="openapi.json")return json(openApiDocument());
  if(m==="GET"&&p.join("/")==="capabilities")return json(capabilities);
  if(m==="GET"&&p.join("/")==="account")return json({account,identity:identity.kind,permission:identity.permission});
  if(m==="GET"&&p.join("/")==="account/quota")return json(await quota(account));
  if(m==="GET"&&p[0]==="operations"&&p.length===2)return json(await operation(account,p[1]));
  if(p[0]!=="computers")throw new ApiError(404,"Not found");
  const key=req.headers.get("idempotency-key");
  if(m==="POST"&&(p.length===1||p.join("/")==="computers/plan")){
   const raw=await req.text();if(raw.length>16384)throw new ApiError(413,"Spec too large");
   let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
   const parsed=computerSpec.safeParse(input);if(!parsed.success)return json({error:"Invalid ComputerSpec",issues:parsed.error.issues},422);
   const s=parsed.data;
   if(s.architecture!=="amd64")throw new ApiError(422,"ARM64 image/runner not yet certified");
   if(p.length===2){await requireAccountCapacity(account,specUsage(s));const manifest=vmManifest("vm-00000000000000000000000000000000",account,s);await kube("POST",vmPath()+"?dryRun=All",manifest);return json({validated:s,manifest,warning:"Dry-run quota snapshot only; capacity is checked again at creation"});}
   return json(await mutate(account,key,{action:"create",spec:s},opId=>withAccountLock(account,async()=>{
    await requireAccountCapacity(account,specUsage(s));
    const id="vm-"+opId.replaceAll("-","");const vm=await kube("POST",vmPath(),vmManifest(id,account,s)) as Resource;if(s.storage?.exchangeMode==="virtiofs")await ensureExchange(id,account,vm,true);return {id};
   })),202);
  }
  if(m==="GET"&&p.length===1)return json(await list(account));
  const id=p[1];if(!id)throw new ApiError(404,"Not found");
  if(m==="GET"&&p.length===2){const vm=await owned(id,account);let vmi:unknown=null;try{vmi=await kube("GET",vmiPath(id));}catch(e){if(!(e instanceof ApiError)||e.status!==404)throw e;}return json({id,resourceVersion:vm.metadata?.resourceVersion,desired:vm.spec,status:vm.status,instance:vmi});}
  if(m==="GET"&&p.length===3&&p[2]==="storage")return json(await inspectStorage(id,account));
  if(p[2]==="files"){
   await owned(id,account);
   if(m==="GET"&&p.length===3)return await exchangeRequest(id,account,"GET","/files");
   if(p.length===4){
    const name=exchangeFileName(p[3]);
    if(m==="GET")return await exchangeRequest(id,account,"GET","/files/"+name);
    if(m==="PUT"){
     const digest=req.headers.get("x-content-sha256");
     if(!digest||!/^[0-9a-f]{64}$/.test(digest))throw new ApiError(422,"SHA256 required");
     const key=req.headers.get("idempotency-key");
     const reader=req.body?.getReader();if(!reader)throw new ApiError(400,"Missing file bytes");
     let size=0;const chunks:Buffer[]=[];
     try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>8*1024*1024){await reader.cancel();throw new ApiError(413,"Exchange file too large")}chunks.push(Buffer.from(next.value))}}finally{reader.releaseLock()}
     const bytes=Buffer.concat(chunks);
     const result=await mutate(account,key,{action:"upload-file",id,name,digest,size},async()=>{
      const resp=await exchangeRequest(id,account,"PUT","/files/"+name,bytes,digest);return resp.json();
     });return json(result,202);
    }
   }
  }
  if(p[2]==="recordings"){
   if(m==="GET"&&p.length===3)return json(await listRecordings(account,id));
   if(m==="POST"&&p.length===3){
    const raw=await req.text();if(raw.length>1024)throw new ApiError(413,"Recording request too large");
    let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
    const parsed=recordingSpec.safeParse(input);if(!parsed.success)throw new ApiError(422,"Explicit recording consent and valid duration required");
    return json(await mutate(account,key,{action:"recording-start",id,spec:parsed.data},opId=>startRecording(account,id,opId,parsed.data)),202);
   }
   if(p.length>=4){const rid=p[3];
    if(m==="GET"&&p.length===4)return json(await recordingStatus(account,id,rid));
    if(m==="POST"&&p.length===5&&p[4]==="stop")return json(await mutate(account,key,{action:"recording-stop",id,rid},()=>stopRecording(account,id,rid)),202);
    if(m==="DELETE"&&p.length===4)return json(await mutate(account,key,{action:"recording-delete",id,rid},()=>deleteRecording(account,id,rid)),202);
    if(m==="GET"&&p.length===5&&p[4]==="file"){
     const artifact=await recordingFile(account,id,rid);
     return new Response(artifact.body,{headers:{"content-type":"video/mp4","content-length":String(artifact.size),"content-disposition":"attachment; filename=\""+rid+".mp4\"","cache-control":"no-store","x-content-type-options":"nosniff","x-content-sha256":artifact.sha256}});
    }
   }
  }
  if(m==="GET"&&p.length===3&&p[2]==="input-lease")return json(await inputStatus(account,id));
  if(p[2]==="console-tickets"){
   if(m==="POST"&&p.length===3){
    const raw=await req.text();if(raw.length>512)throw new ApiError(413,"Ticket request too large");
    let scope:"screenshot-only"|"observe-vnc"|"control-vnc"="screenshot-only";
    if(raw.length){
     let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
     if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==1||!("scope" in input)||(input.scope!=="screenshot-only"&&input.scope!=="observe-vnc"&&input.scope!=="control-vnc"))throw new ApiError(422,"Invalid ticket scope");
     scope=input.scope;
    }
    return json(await issueDisplayTicket(account,id,scope,identity.kind==="account-key"?identity.keyId:undefined),201);
   }
   if(m==="GET"&&p.length===3)return json(await listDisplayTickets(account,id));
   if(m==="DELETE"&&p.length===4)return json(await revokeDisplayTicket(account,id,p[3]));
  }
  if(m==="GET"&&p.length===3&&p[2]==="screenshot"){
   const png=await screenshot(id,account);
   return imageResponse(png);
  }
  if(m==="GET"&&p.length===3&&p[2]==="guest"){
   await owned(id,account);
   let vmi:Resource|null=null;
   try{vmi=await kube("GET",vmiPath(id)) as Resource;}catch(e){if(!(e instanceof ApiError)||e.status!==404)throw e;}
   return json(guestObservation(id,vmi));
  }
  if((m==="PATCH"&&p.length===3&&p[2]==="hardware")||(m==="POST"&&p.length===4&&p[2]==="hardware"&&p[3]==="plan")){
   await owned(id,account);
   const raw=await req.text();if(raw.length>4096)throw new ApiError(413,"Hardware configuration too large");
   let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
   const parsed=hardwareSpec.safeParse(input);if(!parsed.success)return json({error:"Invalid hardware configuration",issues:parsed.error.issues},422);
   if(m==="POST")return json(await withAccountLock(account,()=>configureHardware(account,id,parsed.data,true),id));
   return json(await mutate(account,key,{action:"hardware",id,spec:parsed.data},()=>withAccountLock(account,()=>configureHardware(account,id,parsed.data),id)),202);
  }
  if(m==="DELETE"&&p.length===2){
   const confirm=new URL(req.url).searchParams.get("deleteDisks")==="true";
   return json(await mutate(account,key,{action:"delete",id,deleteDisks:confirm},()=>withVmLock(id,async()=>{
    const vm=await owned(id,account);
    const disks=managedDisks(vm,id);
    requireDeleteConfirmation(disks,confirm);
    await kube("DELETE",vmPath(id),{propagationPolicy:"Foreground",preconditions:{uid:vm.metadata?.uid}});
    return {id,affectedDisks:disks.map(d=>d.name)};
   })),202);
  }
  if(m==="POST"&&p.length===3&&["start","stop","restart"].includes(p[2]))return json(await mutate(account,key,{action:p[2],id},()=>withVmLock(id,async()=>{const vm=await owned(id,account);if(p[2]==="start"&&exchangeConfigured(vm))await ensureExchange(id,account,vm);await kube("PUT",actionPath(id,p[2]),{});return {id};})),202);
  throw new ApiError(404,"Endpoint not implemented");
 }catch(e){return json({error:e instanceof ApiError?e.message:"Internal service error"},e instanceof ApiError?e.status:500);}
}
export const GET=handle;
export const POST=handle;
export const DELETE=handle;
export const PATCH=handle;
export const PUT=handle;
