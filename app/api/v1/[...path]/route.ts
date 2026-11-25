import {authenticate,keySpec,requirePermission,issueKey,listKeys,revokeKey,rotateKey} from "../../../../src/account-keys";
import {schema,vmManifest} from "../../../../src/spec";
import {parseComputerRequest,advancedSchema} from "../../../../src/advanced-spec";
import {catalog} from "../../../../src/catalog";
import {ApiError,kube,vmPath,vmiPath,actionPath,resetPath,owned,list,type Resource} from "../../../../src/kube";
import {mutate,operation,listOperations,recordOperationTarget} from "../../../../src/operation";
import {migrate} from "../../../../src/db";
import {openApiDocument} from "../../../../src/openapi";
import {inspectStorage,managedDisks,requireDeleteConfirmation} from "../../../../src/storage";
import {hardwareSpec,configureHardware,withVmLock} from "../../../../src/hardware";
import {bootSpec,configureBoot} from "../../../../src/boot";
import {guestObservation} from "../../../../src/guest";
import {screenshot} from "../../../../src/screenshot";
import {displayToken,issueDisplayTicket,lookupDisplayTicket,listDisplayTickets,revokeDisplayTicket} from "../../../../src/console-tickets";
import {acquireInput,releaseInput,inputStatus} from "../../../../src/input-lease";
import {recordingSpec,startRecording,stopRecording,recordingStatus,listRecordings,recordingFile,deleteRecording} from "../../../../src/recordings";
import {quota,requireAccountCapacity,specUsage,withAccountLock} from "../../../../src/quota";
import {batchSpec,dispatchBatch} from "../../../../src/input-batch";
import {ensureExchange,exchangeRequest,exchangeFileName,exchangeConfigured} from "../../../../src/exchange";
import {mediaStatus,uploadMedia,uploadMediaChunk,commitMediaStage,requireMediaReady,type Slot} from "../../../../src/media";
import {chunkLength,readChunk,validateChunk,discardStage} from "../../../../src/media-resume";
import {exposureSpec,issueExposure,listExposures,revokeExposure} from "../../../../src/network";
import {auditContext,recordAudit,rateLimit,auditHistory,type AuditContext} from "../../../../src/audit";
import {touchIdleActivity} from "../../../../src/idle";
import {boundedBody,boundedText} from "../../../../src/request-body";
import {mediaMaxBytes,stageMaxBytes,systemMaxGiB,accountMaxStorageGiB} from "../../../../src/media-config";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
const imageResponse=(png:Buffer)=>new Response(Uint8Array.from(png),{headers:{"content-type":"image/png","cache-control":"no-store","x-content-type-options":"nosniff","content-disposition":"inline; filename=\"screenshot.png\""}});
const capabilities={phase:"console and storage development",verified:["native amd64 KVM lifecycle, account isolation, cold CPU/RAM, CDI/PVC identities, desired-resource quotas, authenticated PNG display capture (CI 45542879476)","hashed account keys, scoped display tickets, pinned image CDI, shared read-only RFB (CI 45544070366)"],implementedUnverified:["durable input lease and server-side input gating","explicit-consent sampled MP4 recording and retrieval","bounded lease-fenced HTTP input batches","VirtioFS profile and bounded account-scoped file bytes","bounded authorized CDI disk/ISO media upload","private guest masquerade network and expiring TCP tunnel","durable operation intent and read-only convergence reconciliation","resumable offset- and digest-verified media staging (larger profiles operator-configured)","opt-in idle stop, audit, request rate and body limits","hard reset, cold boot preference"],conditional:["ARM64 uploaded UEFI virtio disk evaluation (operator opt-in; native KVM/guest validation required)","VirtioFS (native guest mount and byte roundtrip verified; product file API pending)","virtio-mem (driver present on Fedora; live resize not certified)"],unsupported:["Windows-sized media import certification","public network exposure","hotplug","snapshots","migration","GPU"]};
async function handleCore(req:Request,context:{audit?:AuditContext}){
 try{
  const p=new URL(req.url).pathname.split("/").filter(Boolean).slice(2), m=req.method;
  if(m==="GET"&&p.join("/")==="health"){await migrate();await kube("GET",vmPath()+"?limit=1");return json({ready:true});}
  const authorization=req.headers.get("authorization");
  const ticket=displayToken(authorization);
  if(ticket&&m==="GET"&&p[0]==="computers"&&p.length===3&&p[2]==="screenshot"){
   const grant=await lookupDisplayTicket(ticket,p[1]);
   context.audit=auditContext(grant.account,"console",m,p);await rateLimit(grant.account);await touchIdleActivity(p[1],grant.account);
   const png=await screenshot(p[1],grant.account,grant.instanceUid);
   // Do not return captured bytes after revocation or expiry during capture.
   await lookupDisplayTicket(ticket,p[1]);
   return imageResponse(png);
  }
  if(ticket&&p[0]==="computers"&&p.length===3&&p[2]==="input-lease"){
   const grant=await lookupDisplayTicket(ticket,p[1]);context.audit=auditContext(grant.account,"console",m,p);await rateLimit(grant.account);await touchIdleActivity(p[1],grant.account);
   if(m==="POST"){
    const raw=await boundedText(req,256);
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
   context.audit=auditContext(grant.account,"console",m,p);await rateLimit(grant.account);
   if(grant.scope!=="control-vnc")throw new ApiError(403,"Control ticket required");
   await touchIdleActivity(p[1],grant.account);
   const bytes=await boundedBody(req,16384);
   let raw:unknown;try{raw=JSON.parse(bytes.toString("utf8"))}catch{throw new ApiError(400,"Invalid JSON")}
   const parsed=batchSpec.safeParse(raw);if(!parsed.success)throw new ApiError(422,"Invalid input batch");
   return json(await mutate(grant.account,req.headers.get("idempotency-key"),{action:"input",id:p[1],ticketId:grant.id,batch:parsed.data},()=>dispatchBatch(p[1],ticket,parsed.data)),202);
  }
  const identity=await authenticate(authorization);
  if(!identity)return json({error:"Unauthorized"},401);
  const account=identity.account;
  context.audit=auditContext(account,identity.kind==="account-key"?"key":"test",m,p);await rateLimit(account);
  requirePermission(identity,m,p[0]==="keys");
  if(p[0]==="keys"){
   if(m==="GET"&&p.length===1)return json(await listKeys(account));
   if(m==="POST"&&p.length===1){
    const raw=await boundedText(req,4096);
    let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
    const parsed=keySpec.safeParse(input);if(!parsed.success)throw new ApiError(422,"Invalid account key specification");
    return json(await issueKey(account,parsed.data),201);
   }
   if(m==="DELETE"&&p.length===2)return json(await revokeKey(account,p[1]));
   if(m==="POST"&&p.length===3&&p[2]==="rotate")return json(await rotateKey(account,p[1]),201);
   throw new ApiError(404,"Not found");
  }
  if(m==="GET"&&p.join("/")==="schema")return json(schema);
  if(m==="GET"&&p.join("/")==="schema/advanced")return json(advancedSchema);
  if(m==="GET"&&p.join("/")==="images")return json(catalog);
  if(m==="GET"&&p.join("/")==="openapi.json")return json(openApiDocument());
  if(m==="GET"&&p.join("/")==="capabilities")return json({...capabilities,qualification:{arm64EvaluationEnabled:process.env.VM_ENABLE_ARM64_EVALUATION==="true",uploadedGuestExchangeEvaluationEnabled:process.env.VM_ENABLE_GUEST_EXCHANGE_EVALUATION==="true",mediaMaxBytes,stageMaxBytes,systemMaxGiB,accountMaxStorageGiB,storageClass:"local-path",diskExpansionCertified:false,liveResizeCertified:false,secureBootCertified:false,persistentTpmCertified:false,publicExposureCertified:false}});
  if(m==="GET"&&p.join("/")==="account")return json({account,identity:identity.kind,permission:identity.permission});
  if(m==="GET"&&p.join("/")==="audit")return json(await auditHistory(account));
  if(m==="GET"&&p.join("/")==="account/quota")return json(await quota(account));
  if(m==="GET"&&p[0]==="operations"&&p.length===1)return json(await listOperations(account));
  if(m==="GET"&&p[0]==="operations"&&p.length===2)return json(await operation(account,p[1]));
  if(p[0]!=="computers")throw new ApiError(404,"Not found");
  const key=req.headers.get("idempotency-key");
  if(m==="POST"&&(p.length===1||p.join("/")==="computers/plan")){
   const raw=await boundedText(req,16384);
   let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
   const parsed=parseComputerRequest(input);if(!parsed.success)return json({error:"Invalid ComputerSpec",issues:parsed.error.issues},422);
   const s=parsed.data;
   if(s.architecture==="arm64"&&process.env.VM_ENABLE_ARM64_EVALUATION!=="true")throw new ApiError(422,"ARM64 evaluation disabled; eligible native KVM operator profile required");
   if(s.storage?.exchangeMode==="virtiofs"&&s.image!=="fedora-exchange-test"&&process.env.VM_ENABLE_GUEST_EXCHANGE_EVALUATION!=="true")throw new ApiError(422,"Guest exchange evaluation disabled; operator must qualify guest drivers and storage");
   if(p.length===2){await requireAccountCapacity(account,specUsage(s));const manifest=vmManifest("vm-00000000000000000000000000000000",account,s);await kube("POST",vmPath()+"?dryRun=All",manifest);return json({validated:s,manifest,warning:"Dry-run quota snapshot only; capacity is checked again at creation"});}
   return json(await mutate(account,key,{action:"create",spec:s},opId=>withAccountLock(account,async()=>{
    await requireAccountCapacity(account,specUsage(s));
    const id="vm-"+opId.replaceAll("-","");const vm=await kube("POST",vmPath(),vmManifest(id,account,s)) as Resource;if(s.storage?.exchangeMode==="virtiofs")await ensureExchange(id,account,vm,true);return {id};
   })),202);
  }
  if(m==="GET"&&p.length===1)return json(await list(account));
  const id=p[1];if(!id)throw new ApiError(404,"Not found");
  await touchIdleActivity(id,account);
  if(m==="GET"&&p.length===2){const vm=await owned(id,account);let vmi:unknown=null;try{vmi=await kube("GET",vmiPath(id));}catch(e){if(!(e instanceof ApiError)||e.status!==404)throw e;}return json({id,resourceVersion:vm.metadata?.resourceVersion,desired:vm.spec,status:vm.status,instance:vmi});}
  if(m==="GET"&&p.length===3&&p[2]==="storage")return json(await inspectStorage(id,account));
  if(p[2]==="exposures"){
   if(m==="GET"&&p.length===3)return json(await listExposures(account,id));
   if(m==="POST"&&p.length===3){
    const raw=await boundedText(req,1024);
    let input:unknown;try{input=JSON.parse(raw)}catch{throw new ApiError(400,"Invalid JSON")}
    const parsed=exposureSpec.safeParse(input);if(!parsed.success)throw new ApiError(422,"Only bounded private TCP tunnel grants supported");
    return json(await issueExposure(account,id,parsed.data,identity.kind==="account-key"?identity.keyId:undefined),201);
   }
   if(m==="DELETE"&&p.length===4)return json(await revokeExposure(account,id,p[3]));
  }
  if(p[2]==="media"){
   if(m==="GET"&&p.length===3)return json(await mediaStatus(id,account));
   if(!["boot","installer","auxiliary"].includes(p[3]??""))throw new ApiError(404,"Media slot not found");
   const slot=p[3] as Slot;
   if(m==="GET"&&p.length===4){const state=await mediaStatus(id,account,slot);if(!state)throw new ApiError(404,"Media slot not found");return json(state)}
   if(p.length===5&&["chunks","commit"].includes(p[4])){
    const state=await mediaStatus(id,account,slot);
    if(!state||state.slot!==p[3])throw new ApiError(404,"Media slot not found");
    if(m==="PUT"&&p[4]==="chunks"){
     if(!key||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new ApiError(400,"Valid Idempotency-Key required");
     const rawOffset=req.headers.get("upload-offset"),sha256=req.headers.get("x-content-sha256");
     if(!rawOffset||!/^(0|[1-9][0-9]*)$/.test(rawOffset)||!sha256||!/^[a-f0-9]{64}$/.test(sha256))throw new ApiError(422,"Canonical offset and chunk SHA256 required");
     const offset=Number(rawOffset),length=chunkLength(state.metadata.bytes,offset);
     if(!req.body)throw new ApiError(400,"Missing chunk body");
     const contentLength=req.headers.get("content-length");
     if(contentLength!==null&&Number(contentLength)!==length)throw new ApiError(422,"Chunk content length differs from expected length");
     const bytes=await readChunk(req.body,length);
     validateChunk(state.metadata.bytes,offset,bytes,sha256);
     return json(await mutate(account,key,{action:"media-chunk",id,slot:state.slot,offset,length,sha256,mediaSha256:state.metadata.sha256},()=>withVmLock(id,()=>uploadMediaChunk(id,account,state.slot,offset,bytes,sha256))),202);
    }
    if(m==="POST"&&p[4]==="commit")return json(await mutate(account,key,{action:"media-commit",id,slot:state.slot,sha256:state.metadata.sha256,bytes:state.metadata.bytes},opId=>withVmLock(id,()=>commitMediaStage(id,account,state.slot,opId))),202);
    if(m==="DELETE"&&p[4]==="chunks")return json(await mutate(account,key,{action:"media-discard",id,slot:state.slot},()=>withVmLock(id,()=>discardStage(id,account,state.slot))),202);
   }
   if(m==="PUT"&&p.length===4){
    const state=await mediaStatus(id,account,slot);
    if(!state||state.slot!==p[3])throw new ApiError(404,"Media slot not found");
    const length=req.headers.get("content-length");
    if(length!==null&&Number(length)!==state.metadata.bytes)throw new ApiError(422,"Media length differs from declaration");
    if(!req.body)throw new ApiError(400,"Missing media bytes");
    const body=req.body;
    return json(await mutate(account,key,{action:"media-upload",id,slot:state.slot,sha256:state.metadata.sha256,bytes:state.metadata.bytes},opId=>withVmLock(id,()=>uploadMedia(id,account,state.slot,body,opId))),202);
   }
  }
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
     if(!req.body)throw new ApiError(400,"Missing file bytes");
     const bytes=await boundedBody(req,8*1024*1024),size=bytes.length;
     const result=await mutate(account,key,{action:"upload-file",id,name,digest,size},async()=>{
      const resp=await exchangeRequest(id,account,"PUT","/files/"+name,bytes,digest);return resp.json();
     });return json(result,202);
    }
   }
  }
  if(p[2]==="recordings"){
   if(m==="GET"&&p.length===3)return json(await listRecordings(account,id));
   if(m==="POST"&&p.length===3){
    const raw=await boundedText(req,1024);
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
    const raw=await boundedText(req,512);
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
  if((m==="PATCH"&&p.length===3&&p[2]==="boot")||(m==="POST"&&p.length===4&&p[2]==="boot"&&p[3]==="plan")){
   await owned(id,account);
   const raw=await boundedText(req,4096);
   let input:unknown;try{input=JSON.parse(raw)}catch{throw new ApiError(400,"Invalid JSON")}
   const parsed=bootSpec.safeParse(input);if(!parsed.success)return json({error:"Invalid boot configuration",issues:parsed.error.issues},422);
   if(m==="POST")return json(await withVmLock(id,()=>configureBoot(account,id,parsed.data,true)));
   return json(await mutate(account,key,{action:"boot",id,spec:parsed.data},opId=>withVmLock(id,async()=>{const vm=await owned(id,account);if(!vm.metadata?.uid)throw new ApiError(409,"VM identity unavailable");await recordOperationTarget(account,opId,{vmUid:vm.metadata.uid});return configureBoot(account,id,parsed.data)})),202);
  }
  if((m==="PATCH"&&p.length===3&&p[2]==="hardware")||(m==="POST"&&p.length===4&&p[2]==="hardware"&&p[3]==="plan")){
   await owned(id,account);
   const raw=await boundedText(req,4096);
   let input:unknown;try{input=JSON.parse(raw);}catch{throw new ApiError(400,"Invalid JSON");}
   const parsed=hardwareSpec.safeParse(input);if(!parsed.success)return json({error:"Invalid hardware configuration",issues:parsed.error.issues},422);
   if(m==="POST")return json(await withAccountLock(account,()=>configureHardware(account,id,parsed.data,true),id));
   return json(await mutate(account,key,{action:"hardware",id,spec:parsed.data},opId=>withAccountLock(account,async()=>{const vm=await owned(id,account);if(!vm.metadata?.uid)throw new ApiError(409,"VM identity unavailable");await recordOperationTarget(account,opId,{vmUid:vm.metadata.uid});return configureHardware(account,id,parsed.data)},id)),202);
  }
  if(m==="DELETE"&&p.length===2){
   const confirm=new URL(req.url).searchParams.get("deleteDisks")==="true";
   return json(await mutate(account,key,{action:"delete",id,deleteDisks:confirm},opId=>withVmLock(id,async()=>{
    const vm=await owned(id,account);
    const disks=managedDisks(vm,id);
    requireDeleteConfirmation(disks,confirm);
    if(!vm.metadata?.uid)throw new ApiError(409,"VM identity unavailable");
    await recordOperationTarget(account,opId,{vmUid:vm.metadata.uid,disks:disks.map(d=>d.name)});
    await kube("DELETE",vmPath(id),{propagationPolicy:"Foreground",preconditions:{uid:vm.metadata?.uid}});
    return {id,affectedDisks:disks.map(d=>d.name)};
   })),202);
  }
  if(m==="POST"&&p.length===3&&p[2]==="reset"){
   await owned(id,account);
   const raw=await boundedText(req,512);
   let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw new ApiError(400,"Invalid JSON")}
   if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||Object.keys(parsed).length!==2||!("confirmHardReset" in parsed)||parsed.confirmHardReset!==true||!("instanceUid" in parsed)||typeof parsed.instanceUid!=="string"||!/^[0-9a-f-]{36}$/.test(parsed.instanceUid))throw new ApiError(422,"Explicit hard-reset confirmation and current instanceUid required");
   const instanceUid=parsed.instanceUid;
   return json(await mutate(account,key,{action:"reset",id,instanceUid},opId=>withVmLock(id,async()=>{
    const vm=await owned(id,account);if(!vm.metadata?.uid)throw new ApiError(409,"VM identity unavailable");
    let vmi:Resource;try{vmi=await kube("GET",vmiPath(id)) as Resource}catch(e){if(e instanceof ApiError&&e.status===404)throw new ApiError(409,"Running instance required");throw e}
    if(vmi.metadata?.uid!==instanceUid||(vmi.status as {phase?:string}|undefined)?.phase!=="Running"||vm.metadata.deletionTimestamp||vmi.metadata?.deletionTimestamp)throw new ApiError(409,"Running instance identity changed");
    await recordOperationTarget(account,opId,{vmUid:vm.metadata.uid,previousInstanceUid:instanceUid});
    await kube("PUT",resetPath(id));
    return {id,instanceUid,warning:"Hard reset submitted; guest reboot requires independent observation"};
   })),202);
  }
  if(m==="POST"&&p.length===3&&["start","stop","restart"].includes(p[2]))return json(await mutate(account,key,{action:p[2],id},opId=>withVmLock(id,async()=>{const vm=await owned(id,account);if(!vm.metadata?.uid)throw new ApiError(409,"VM identity unavailable");let previousInstanceUid:string|null=null;try{previousInstanceUid=(await kube("GET",vmiPath(id)) as Resource).metadata?.uid??null}catch(e){if(!(e instanceof ApiError)||e.status!==404)throw e}await recordOperationTarget(account,opId,{vmUid:vm.metadata.uid,previousInstanceUid});if(p[2]==="start"){await requireMediaReady(id,account);if(exchangeConfigured(vm))await ensureExchange(id,account,vm)}await kube("PUT",actionPath(id,p[2]),{});return {id};})),202);
  throw new ApiError(404,"Endpoint not implemented");
 }catch(e){return json({error:e instanceof ApiError?e.message:"Internal service error"},e instanceof ApiError?e.status:500);}
}
async function handle(req:Request){
 const context:{audit?:AuditContext}={};
 const result=await handleCore(req,context);
 if(context.audit&&result.status!==429)try{await recordAudit(context.audit,result.status)}catch{console.error("Audit persistence unavailable")}
 return result;
}
export const GET=handle;
export const POST=handle;
export const DELETE=handle;
export const PATCH=handle;
export const PUT=handle;
