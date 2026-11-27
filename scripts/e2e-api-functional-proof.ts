/** API-only real guest program, VirtioFS exchange, independent clone and original recording. */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {proofTools,batch} from "./proof-tools.ts";
import {sha,key,sleep,wait,writeJson,type CallOptions} from "./api-client.ts";
import {packageBytes,launcherCloud,verifyArchive,verifyPlatform,verifyPointerReceipt,runtimeParts,verifyRuntime} from "./linux-showcase-fixture.ts";
import {ocr} from "./evidence-frames.ts";
const h=proofTools("evidence/api-functional-proof"),{call,binary,B,file,screen}=h;
let path:string|undefined,record:string|undefined,keyId:string|undefined,ticket:string|undefined,lease=false;
const control=(body?:unknown,expected=200,phase?:string,idem?:string):CallOptions=>({token:ticket,scheme:"Console",body,expected,phase,idem});
try{
 assert(process.platform==="linux"&&process.arch==="x64");const runtime=runtimeParts(),software=packageBytes(),softwareDigest=sha(software),cloud=launcherCloud(runtime),spec={version:1,name:"api-functional-proof",architecture:"amd64",cpu:1,memoryMiB:1536,image:"fedora-exchange-test",storage:{systemGiB:8,exchangeGiB:1,exchangeMode:"virtiofs"},cloudInit:cloud,pointerTablet:"usb"};
 await call("POST","/computers/plan",{body:spec});const vm=await call("POST","/computers",{body:spec,expected:202,phase:"create"});path="/computers/"+vm.result.id;const p=path!;
 const state=()=>call("GET",p);
 async function coldDisk(action:string,name:string,fields:Record<string,unknown>={}){
  const initial=(await state()).desired,end=performance.now()+60000,conflicts=["VM identity or resource version changed","VM resource version changed before disk reservation"];
  while(performance.now()<end){
   let current=await state();assert.deepEqual(current.desired,initial);
   const body={action,name,expectedResourceVersion:current.resourceVersion,...fields};const planned=await call("POST",p+"/disks/plan",{body,expected:[200,409]});
   if(planned.error){assert(conflicts.includes(planned.error));await sleep(1);continue;}
   current=await state();assert.deepEqual(current.desired,initial);body.expectedResourceVersion=current.resourceVersion;
   const idem=key(),submitted=await call("POST",p+"/disks",{body,idem,expected:[202,409],phase:"cold disk "+action});
   if(submitted.error){assert(conflicts.includes(submitted.error));assert.deepEqual(await call("POST",p+"/disks",{body,idem,expected:409}),submitted);await sleep(1);continue;}
   assert.equal(submitted.status,"submitted");assert.deepEqual(await call("POST",p+"/disks",{body,idem,expected:202}),submitted);return submitted;
  }
  throw Error("Cold disk version did not stabilize");
 }
 type Volume={kind:string;diskName?:string;pvcPhase:string;pvcUid:string;dataVolumePhase:string};
 const volumes=async()=>(await call("GET",p+"/storage")).volumes as Volume[];
 const getDisk=async(name:string)=>(await volumes()).find(v=>v.diskName===name);
 await coldDisk("create","proof",{sizeGiB:1});await coldDisk("attach","proof");
 const image=(await call("GET","/images")).find((v:{id:string})=>v.id===spec.image);assert(image.architecture==="amd64"&&image.digest.startsWith("sha256:")&&image.image.endsWith(image.digest));
 const data=randomBytes(4096),digest=sha(data),expected=Buffer.from("guest-result:"+digest+"\n"),headers=(sha256:string)=>({"Content-Type":"application/octet-stream","X-Content-SHA256":sha256});
 await call("PUT",p+"/files/challenge.bin",{token:B,expected:404,raw:data,headers:headers(digest)});
 const upload=await call("PUT",p+"/files/challenge.bin",{expected:202,raw:data,headers:headers(digest),phase:"upload file"});assert.equal(upload.result.sha256,digest);
 const softwareUpload=await call("PUT",p+"/files/proof.zip",{expected:202,raw:software,headers:headers(softwareDigest),phase:"upload software"});assert.equal(softwareUpload.result.sha256,softwareDigest);
 for(const part of runtime.chunks){const received=await call("PUT",p+"/files/"+part.name,{expected:202,raw:part.bytes,headers:headers(part.sha256),timeout:120,phase:"upload Node runtime"});assert.equal(received.result.sha256,part.sha256);}
 const runtimeManifest={version:runtime.version,executableSha256:runtime.executableSha256,executableBytes:runtime.executableBytes,compressedSha256:runtime.compressedSha256,compressedBytes:runtime.compressedBytes,chunks:runtime.chunks.map(v=>({name:v.name,bytes:v.bytes.length,sha256:v.sha256}))};writeJson(file("runtime-provenance.json"),runtimeManifest);assert.deepEqual(await call("GET",p+"/files"),[]);
 await call("POST",p+"/start",{body:{},expected:202,phase:"start"});
 const running=async()=>{const i=(await state()).instance;return i?.status.phase==="Running"?i.metadata.uid:null;},uid=await wait(running,420,"VMI not Running");
 assert((await state()).instance.spec.domain.devices.inputs.some((x:{type:string;bus:string;name:string})=>x.type==="tablet"&&x.bus==="usb"&&x.name==="tablet1"));
 const identities=async()=>{const v=await volumes();return v.every(x=>x.pvcPhase==="Bound"&&x.pvcUid)?Object.fromEntries(v.map(x=>[x.diskName??x.kind,x.pvcUid])):null;};
 const original=await wait(identities,120,"Persistent storage not bound");assert.deepEqual(Object.keys(original).sort(),["boot","exchange","proof"]);
 await wait(async()=>{const [text]=await screen(p,"before.png");return text.includes("proofready")&&!text.includes("proofcomplete");},300,"Client-supplied guest app not visible");assert.deepEqual(await call("GET",p+"/files"),[],"Result exists before guest interaction");
 const k=await call("POST","/keys",{body:{label:"functional-proof",permission:"manage",ttlSeconds:600},expected:201,phase:"controller key"});keyId=k.id;
 const grant=await call("POST",p+"/console-tickets",{token:k.token,body:{scope:"control-vnc"},expected:201,phase:"control ticket"});ticket=grant.token;assert(grant.actor==="automation"&&grant.instanceUid===uid);
 const started=await call("POST",p+"/recordings",{body:{consent:true,maxSeconds:120},expected:202,phase:"record start"});record=p+"/recordings/"+started.result.id;const rec=record!;
 await wait(async()=>{const s=await call("GET",rec);assert.notEqual(s.status,"failed");return s.status==="recording";},20,"Recording did not start");await sleep(5);
 const claim=await call("POST",p+"/input-lease",control({},200,"lease acquire"));lease=true;assert(claim.active&&claim.actor==="automation");
 const events=[...batch("runproof").events,{type:"key",keysym:0xff0d,down:true},{type:"key",keysym:0xff0d,down:false}],idem=key(),action=await call("POST",p+"/input",control({events},202,"guest action",idem));assert.equal(action.result.accepted,events.length);assert.deepEqual(await call("POST",p+"/input",control({events},202,"idempotent replay",idem)),action);
 await wait(async()=>(await screen(p,"pointer-ready.png"))[0].includes("pointerready"),30,"Actual guest tablet was not ready");
 const shot=readFileSync(file("pointer-ready.png")),width=shot.readUInt32BE(16),height=shot.readUInt32BE(20);assert(width>=32&&width<=1920&&height>=32&&height<=1200);
 const observer=await call("POST",p+"/console-tickets",{body:{scope:"observe-vnc"},expected:201}),move={type:"pointer",x:Math.floor(width/4),y:Math.floor(height/4),buttons:0},end={type:"pointer",x:Math.floor(width*3/4),y:Math.floor(height*3/4),buttons:0},pointer={events:[move,end,{...end,buttons:1},end]};
 await call("POST",p+"/input",{...control(pointer,403,"observer pointer denied"),token:observer.token});await call("POST",p+"/input",control({events:[{...move,x:width}]},422,"outside pointer denied"));await call("POST",p+"/input-lease",control({},200,"pointer lease refresh"));
 const pointerKey=key(),clicked=await call("POST",p+"/input",control(pointer,202,"guest pointer action",pointerKey));assert.equal(clicked.result.accepted,pointer.events.length);assert.deepEqual(await call("POST",p+"/input",control(pointer,202,"pointer replay",pointerKey)),clicked);
 await wait(async()=>(await screen(p,"after.png"))[0].includes("proofcomplete"),65,"Actual guest computation not visible");
 async function retrieve(name:string,phase="download "+name,seconds=60){
  await wait(async()=>(await call("GET",p+"/files")).some((f:{name:string})=>f.name===name),seconds,"Missing guest output "+name);
  const [raw,headers]=await binary("GET",p+"/files/"+name,{phase});assert.equal(headers.get("X-Content-SHA256"),sha(raw));writeFileSync(file(name==="result.bin"?"guest-result.bin":name==="archive.zip"?"guest-archive.zip":name),raw);return raw;
 }
 const result=await retrieve("result.bin","download file",20);assert(result.equals(expected));await binary("GET",p+"/files/result.bin",{token:B,expected:404});
 const archive=await retrieve("archive.zip","download archive",20);await verifyArchive(archive,data);
 writeFileSync(file("challenge.bin"),data);writeFileSync(file("software.zip"),software);
 const pointerRaw=await retrieve("pointer-receipt.json");verifyPointerReceipt(pointerRaw,data);assert(ocr(file("after.png")).includes("pointerdone"));assert((await retrieve("disk-original.bin")).equals(data));
 const platform=await retrieve("guest-platform.json"),rpm=await retrieve("guest-rpm.tsv");verifyPlatform(platform,rpm,image.version);const guestRuntime=await retrieve("guest-runtime.json");verifyRuntime(guestRuntime,data,runtime);
 await sleep(5);await call("DELETE",p+"/input-lease",control(undefined,200,"lease release"));lease=false;await call("POST",rec+"/stop",{body:{},expected:202,phase:"record stop"});
 const meta=await wait(async()=>{const s=await call("GET",rec);assert.notEqual(s.status,"failed");return s.status==="completed"?s:null;},100,"Recording did not complete");
 const [video,vh]=await binary("GET",rec+"/file",{phase:"retrieve MP4"});assert(meta.instanceUid===uid&&vh.get("Content-Type")==="video/mp4"&&video.length===meta.bytes&&sha(video)===meta.sha256);const raw=file("platform-recording.mp4");writeFileSync(raw,video);const decoded=h.checkVideo(raw,"proofready","proofcomplete");
 await binary("GET",rec+"/file",{token:B,expected:404});await call("DELETE",rec,{expected:202});record=undefined;await call("DELETE","/keys/"+keyId);keyId=undefined;
 await call("POST",p+"/stop",{body:{},expected:202,phase:"stop"});await wait(async()=>!(await state()).instance,240,"VM stop did not converge");assert((await binary("GET",p+"/files/result.bin"))[0].equals(expected));
 await wait(async()=>{const v=await state(),s=v.status??{};return !v.instance&&v.desired.runStrategy==="Halted"&&!s.created&&!s.ready&&!s.stateChangeRequests?.length;},120,"VM not fully stopped before clone");
 const cloned=await coldDisk("clone","proofcopy",{source:"proof",sizeGiB:2});
 const copy=await wait(async()=>{const d=await getDisk("proofcopy");return d?.dataVolumePhase==="Succeeded"&&d.pvcPhase==="Bound"&&d.pvcUid?d:null;},420,"Clone failed to converge");assert(copy.pvcUid!==original.proof);
 await wait(async()=>(await call("GET","/operations/"+cloned.operationId)).observation?.state==="converged",120,"Clone observation failed");await coldDisk("attach","proofcopy");
 await h.coldResize(p,2,2048);await call("POST",p+"/start",{body:{},expected:202,phase:"restart after resize"});const newUid=await wait(running,420,"Resized VMI not Running");assert.notEqual(newUid,uid);assert.deepEqual(await identities(),{...original,proofcopy:copy.pvcUid});
 const domain=(await state()).instance.spec.domain;assert(domain.cpu.cores===2&&["2048Mi","2Gi"].includes(domain.memory.guest));
 await wait(async()=>(await screen(p,"reboot.png"))[0].includes("proofpersisted"),240,"Installed application did not persist after reboot");
 assert((await binary("GET",p+"/files/result.bin"))[0].equals(expected));assert((await binary("GET",p+"/files/archive.zip"))[0].equals(archive));assert((await retrieve("disk-original-after.bin")).equals(data));assert((await retrieve("disk-clone-after.bin")).equals(Buffer.from(data.map(x=>x^255))));
 await call("POST",p+"/stop",{body:{},expected:202,phase:"stop after resize"});await wait(async()=>!(await state()).instance,240,"Final stop failed");await call("DELETE",p,{expected:409});await call("DELETE",p+"?deleteDisks=true",{expected:202,phase:"delete"});await wait(async()=>!(await call("GET","/computers")).some((v:{id:string})=>v.id===vm.result.id),120,"VM delete did not converge");path=undefined;
 const derived=h.presentation(raw,"REAL NATIVE APPLICATION PROOF");
 writeJson(file("verification.json"),{scope:"native Fedora uploaded and installed Linux archive application, product APIs only",profile:"linux",architecture:"amd64",image,softwareSha256:softwareDigest,archiveSha256:sha(archive),softwareInstalled:true,guestRuntimeSha256:sha(guestRuntime),runtimeProvenanceSha256:sha(readFileSync(file("runtime-provenance.json"))),pointerReceiptSha256:sha(pointerRaw),pointerReadyScreenshotSha256:sha(readFileSync(file("pointer-ready.png"))),pointerDoneScreenshotSha256:sha(readFileSync(file("after.png"))),guestPointerProof:true,coldResizeAndFilePersistence:true,originalPvcUids:original,clonePvcUid:copy.pvcUid,guestDiskCloneByteProof:true,guestPlatformSha256:sha(platform),guestRpmSha256:sha(rpm),resizedInstanceUid:newUid,rebootScreenshotSha256:sha(readFileSync(file("reboot.png"))),runId:process.env.GITHUB_RUN_ID,commit:process.env.GITHUB_SHA,vmId:vm.result.id,instanceUid:uid,inputBytes:data.length,inputSha256:digest,outputBytes:result.length,outputSha256:sha(result),guestComputedResult:true,actualGuestVisibleResult:true,crossAccountDenied:true,replayedActionSameOperation:true,stoppedOutputPersistent:true,recording:{file:"platform-recording.mp4",sha256:meta.sha256,bytes:video.length,...decoded},derivedPresentation:derived,traceSha256:sha(readFileSync(h.trace!))});
 console.log("Linux application installed through API input; actual pointer, archive, clone, recording and resize persistence verified");
}finally{
 const cleanup:[string,string|undefined,CallOptions][]=[["DELETE",path&&lease?path+"/input-lease":undefined,control()],["POST",record?record+"/stop":undefined,{body:{},expected:202}],["DELETE",keyId?"/keys/"+keyId:undefined,{}],["DELETE",path?path+"?deleteDisks=true":undefined,{expected:202}]];
 for(const [method,p,o] of cleanup)if(p)try{await call(method,p,o);}catch{console.error("Cleanup incomplete:",method,p);}
}
