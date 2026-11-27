/** API-only authorized native Windows or Android execution. Human credentials are never collected or recorded. */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {statSync,readFileSync,writeFileSync,openSync,readSync,closeSync} from "node:fs";
import {extname} from "node:path";
import {createInterface} from "node:readline/promises";
import {parseShowcase,validateShowcase,preflight} from "./showcase-preflight.ts";
import {normalize,type Step} from "./showcase-inputs.ts";
import {ANDROID_RESULT_MODE,androidResult} from "./android-fixture.ts";
import {locateLabel} from "./screen-targets.ts";
import {AndroidGuestTransfer,verifyStagedBundle} from "./android-guest-transfer.ts";
import {proofTools,batch} from "./proof-tools.ts";
import {sha,sleep,wait,type CallOptions,writeJson} from "./api-client.ts";
import {fileSha256} from "./tooling.ts";
const args=parseShowcase(process.argv.slice(2)),scenario=validateShowcase(args),win=args.profile==="windows";
if(args.preflightOnly){console.log(JSON.stringify(preflight(args)));process.exit(0);}
const h=proofTools("evidence/showcase-"+args.profile),{call,binary,B,screen,file}=h;
let path:string|undefined,rec:string|undefined,keyId:string|undefined,keySecret:string|undefined,ticket:string|undefined,ticketId:string|undefined,guest:AndroidGuestTransfer|undefined,lease=false,ticketExpiry=0;
const control=(body?:unknown,expected=200,phase?:string):CallOptions=>({token:ticket,scheme:"Console",body,expected,phase});
async function release(){if(ticket&&lease){if(performance.now()<ticketExpiry&&path)await call("DELETE",path+"/input-lease",control());lease=false;}}
async function getTicket(){
 assert(path&&keySecret);
 if(ticket&&performance.now()<ticketExpiry)return;
 if(ticket&&lease)try{await call("DELETE",path+"/input-lease",control());}catch{/* expired ticket */}
 if(ticketId)await call("DELETE",path+"/console-tickets/"+ticketId);
 const grant=await call("POST",path+"/console-tickets",{token:keySecret,body:{scope:"control-vnc"},expected:201,phase:"control ticket"});assert.equal(grant.actor,"automation");ticket=grant.token;ticketId=grant.id;ticketExpiry=performance.now()+95000;lease=false;
}
async function refreshKey(){
 await release();if(keyId)await call("DELETE","/keys/"+keyId);
 const k=await call("POST","/keys",{body:{label:"native-showcase",permission:"manage",ttlSeconds:3600},expected:201});keyId=k.id;keySecret=k.token;
 if(ticketId&&path)await call("DELETE",path+"/console-tickets/"+ticketId);
 ticket=ticketId=undefined;lease=false;ticketExpiry=0;
}
async function send(events:object[]){
 assert(path&&events.length>=1&&events.length<=64);await getTicket();const claim=await call("POST",path+"/input-lease",control({}));lease=true;assert(claim.active&&claim.actor==="automation");const result=await call("POST",path+"/input",control({events},202,"guest action"));assert.equal(result.result.accepted,events.length);
}
async function visible(text:string,label:string,seconds:number){assert(path);const p=path;await wait(async()=>(await screen(p,label+".png"))[0].includes(normalize(text)),seconds,"Expected guest display not reached");}
const running=async()=>{assert(path);const i=(await call("GET",path)).instance;return i?.status.phase==="Running"?i:null;};
async function steps(items:Step[],recording=false){
 assert(path&&items.length<=100);const p=path;
 for(let i=0;i<items.length;i++){
  const s=items[i],label=(recording?"recorded":"setup")+"-"+String(i).padStart(3,"0");
  if("wait" in s)await visible(s.wait.text,label,s.wait.seconds);
  else if("delay" in s)await sleep(s.delay);
  else if("text" in s){for(let j=0;j<s.text.length;j+=24)await send(batch(s.text.slice(j,j+24)).events);}
  else if("keys" in s)await send([...s.keys.map(keysym=>({type:"key",keysym,down:true})),...[...s.keys].reverse().map(keysym=>({type:"key",keysym,down:false}))]);
  else if("click-label" in s){
   const target=s["click-label"],xy=await wait(async()=>{const f=file(label+"-target.png"),[data,headers]=await binary("GET",p+"/screenshot");assert.equal(headers.get("Content-Type"),"image/png");writeFileSync(f,data);return locateLabel(f,target.text);},target.seconds,"Unique guest button not found");const [x,y]=xy;await send([0,1,0].map(buttons=>({type:"pointer",x,y,buttons})));
  }else if("click" in s){const [x,y]=s.click;await send([0,1,0].map(buttons=>({type:"pointer",x,y,buttons})));}
  else if("human" in s){assert(!recording&&!rec,"No recording during credentials/license interaction");await release();console.log("Authorized human checkpoint:",s.human.slice(0,160));console.log("Use an account control-vnc ticket and release it before continuing.");assert(process.stdin.isTTY,"Human checkpoint requires an interactive terminal");const rl=createInterface({input:process.stdin,output:process.stdout});try{await rl.question("Press Enter when complete (never enter credentials here): ");}finally{rl.close();}await refreshKey();}
  else if("system-boot" in s){assert(!recording&&win&&s["system-boot"]);await release();await call("POST",p+"/stop",{body:{},expected:202});await wait(async()=>!(await call("GET",p)).instance,300,"Stop did not converge");const v=await call("GET",p),body={first:"system",installerTray:"open",expectedResourceVersion:v.resourceVersion};await call("POST",p+"/boot/plan",{body});await call("PATCH",p+"/boot",{body,expected:202});await call("POST",p+"/start",{body:{},expected:202});await wait(running,420,"Installed VM failed to start");await refreshKey();}
  else throw Error("Unsupported scenario action");
 }
}
type Volume={kind:string;diskName?:string;pvcUid:string;pvcPhase:string};
async function identities(){assert(path);const volumes=(await call("GET",path+"/storage")).volumes as Volume[];return volumes.length&&volumes.every(v=>v.pvcPhase==="Bound"&&v.pvcUid)?Object.fromEntries(volumes.map(v=>[v.diskName||v.kind,v.pvcUid])):null;}
async function importSlot(slot:string,local:string){
 assert(path);const endpoint=path+"/media/"+slot,state=await wait(async()=>{const s=await call("GET",endpoint);return s.phase==="UploadReady"?s:null;},600,"CDI target unavailable"),chunk=state.chunkBytes,total=statSync(local).size;let offset=state.stagedBytes;
 assert(Number.isSafeInteger(offset)&&offset>=0&&offset<=total&&Number.isInteger(chunk)&&chunk>0&&chunk<=64*1024**2);
 const fd=openSync(local,"r");
 try{while(offset<total){const payload=Buffer.alloc(Math.min(chunk,total-offset));assert.equal(readSync(fd,payload,0,payload.length,offset),payload.length);const result=await call("PUT",endpoint+"/chunks",{raw:payload,expected:202,headers:{"Content-Type":"application/octet-stream","Upload-Offset":String(offset),"X-Content-SHA256":sha(payload)},timeout:240});offset+=payload.length;assert.equal(result.result.received,offset);}}
 finally{closeSync(fd);}
 await call("POST",endpoint+"/commit",{expected:202,timeout:1900});await wait(async()=>(await call("GET",endpoint)).ready,1200,"Verified import not ready");
}
try{
 const fmt=win?"iso":extname(args.media).toLowerCase()===".qcow2"?"qcow2":"raw",media={format:fmt,bytes:statSync(args.media).size,sha256:args.mediaSha256,source:args.source,os:win?"Windows Server 2022":"Android",version:args.version,authorizedByClient:true};
 const spec={version:1,name:"showcase-"+args.profile,architecture:win?"amd64":"arm64",cpu:2,memoryMiB:4096,image:win?"uploaded-installer":"uploaded-disk",firmware:"uefi",bootBus:win?"sata":"virtio",storage:{systemGiB:args.systemGiB,exchangeGiB:1,exchangeMode:"virtiofs",...win?{}:{exchangeTag:"share"}},media,...args.adbMode?{network:"private"}:{},...args.auxiliaryMedia?{auxiliaryDisk:{sizeGiB:args.auxiliaryGiB,media:{...media,format:win?"iso":"qcow2",bytes:statSync(args.auxiliaryMedia).size,sha256:args.auxiliarySha256}}}:{}};
 await call("POST","/computers/plan",{body:spec});const created=await call("POST","/computers",{body:spec,expected:202,phase:"create"});path="/computers/"+created.result.id;const p=path!;
 await call("GET",p,{token:B,expected:404});await call("POST",p+"/start",{body:{},expected:409});await importSlot(win?"installer":"boot",args.media);
 if(args.auxiliaryMedia){await call("POST",p+"/start",{body:{},expected:409});await importSlot("auxiliary",args.auxiliaryMedia);}
 const software=readFileSync(args.software),challenge=randomBytes(win?64:4096),challengeDigest=sha(challenge);
 async function upload(name:string,data:Buffer,phase?:string){const r=await call("PUT",p+"/files/"+name,{raw:data,expected:202,phase,headers:{"Content-Type":"application/octet-stream","X-Content-SHA256":sha(data)}});assert.equal(r.result.sha256,sha(data));return r;}
 async function uploadAndroid(){await upload("proof.apk",software,"upload file");await upload("challenge.bin",challenge,"upload challenge");writeFileSync(file("challenge.bin"),challenge);writeFileSync(file("proof.apk"),software);writeFileSync(file("scenario.json"),readFileSync(args.scenario));}
 let stagedBundle:Buffer|undefined;
 if(args.adbMode){
  await uploadAndroid();const [raw,headers]=await binary("GET",p+"/exchange-bundle",{phase:"staged bundle"});assert.equal(headers.get("X-Content-SHA256"),sha(raw));await binary("GET",p+"/exchange-bundle",{token:B,expected:404});const staged=verifyStagedBundle(raw,{"proof.apk":software,"challenge.bin":challenge});stagedBundle=raw;writeFileSync(file("staged-exchange.tar"),raw);for(const [name,data] of Object.entries(staged))writeFileSync(file("staged-"+name),data);
 }
 if(win)await upload("driver-challenge.bin",challenge);
 await call("POST",p+"/start",{body:{},expected:202,phase:"start"});await wait(running,600,"VM not Running");const original=await wait(identities,120,"Persistent storage not bound");await refreshKey();await steps(scenario.setup);
 if(win){
  await steps([{text:"$d=(Get-Volume | Where-Object FileSystemLabel -eq 'VMDRIVERS').DriveLetter; if (@($d).Count -ne 1) { throw 'Missing driver media' }; & ($d+':\\bootstrap.ps1') -Drive '"+args.exchangeDrive+"' -ChallengeSha256 '"+challengeDigest+"'"},{keys:[0xff0d]},{wait:{text:"VMDRIVERSREADY",seconds:180}}]);
  await upload("software.exe",software,"upload file");await upload("proof.ps1",readFileSync(new URL("../showcases/windows/proof.ps1",import.meta.url)));
 }else if(args.adbMode){
  guest=await AndroidGuestTransfer.create(call,p,B);await guest.authorize(()=>steps([{human:"Approve only the newly displayed RSA debugging key in the guest. Never enable unauthenticated debugging."}]));await guest.install(file("staged-proof.apk"),file("staged-challenge.bin"));
 }else await uploadAndroid();
 await steps(scenario.softwareSetup);await visible(scenario.beforeMarker,"before",120);
 if(guest)await guest.absent();else assert(!(await call("GET",p+"/files")).some((f:{name:string})=>f.name===scenario.resultName),"Stale result");
 const uid=(await wait(running,120,"Guest not running")).metadata.uid,started=await call("POST",p+"/recordings",{body:{consent:true,maxSeconds:120},expected:202,phase:"record start"});rec=p+"/recordings/"+started.result.id;const recording=rec!;
 await wait(async()=>(await call("GET",recording)).status==="recording",20,"Recording not active");await sleep(4);
 if(win)await steps([{text:"& "+args.exchangeDrive+"\\in-proof.ps1 -Exchange "+args.exchangeDrive+"\\"},{keys:[0xff0d]}],true);
 await steps(scenario.application,true);await visible(scenario.afterMarker,"after",45);
 let result:Buffer;if(guest){result=await guest.result();assert(result.equals(androidResult(challenge)));}else{
  await wait(async()=>(await call("GET",p+"/files")).some((f:{name:string})=>f.name===scenario.resultName),20,"Guest output not published");const [bytes,headers]=await binary("GET",p+"/files/"+scenario.resultName,{phase:"download file"});result=bytes;assert.equal(sha(result),headers.get("X-Content-SHA256"));if(win)assert.equal(sha(result),scenario.expectedResultSha256);else assert(result.equals(androidResult(challenge)));await binary("GET",p+"/files/"+scenario.resultName,{token:B,expected:404});
 }
 writeFileSync(file("guest-result.bin"),result);await sleep(4);await release();await call("POST",recording+"/stop",{body:{},expected:202,phase:"record stop"});
 const meta=await wait(async()=>{const s=await call("GET",recording);assert.notEqual(s.status,"failed");return s.status==="completed"?s:null;},120,"Recording incomplete"),[video,headers]=await binary("GET",recording+"/file",{phase:"retrieve MP4"});
 assert(meta.instanceUid===uid&&sha(video)===meta.sha256&&video.length===meta.bytes&&headers.get("Content-Type")==="video/mp4");const raw=file("platform-recording.mp4");writeFileSync(raw,video);const decoded=h.checkVideo(raw,normalize(scenario.beforeMarker),normalize(scenario.afterMarker));await binary("GET",recording+"/file",{token:B,expected:404});await call("DELETE",recording,{expected:202});rec=undefined;
 if(guest)await guest.disconnect();await call("POST",p+"/stop",{body:{},expected:202,phase:"stop"});await wait(async()=>!(await call("GET",p)).instance,300,"Stop failed");await h.coldResize(p,3,4096);
 await call("POST",p+"/start",{body:{},expected:202,phase:"restart after resize"});const resized=await wait(running,600,"Resize restart failed"),newUid=resized.metadata.uid,domain=resized.spec.domain;assert(newUid!==uid&&domain.cpu.cores===3&&["4096Mi","4Gi"].includes(domain.memory.guest));
 const after=await wait(identities,120,"Storage not bound after resize");assert.deepEqual(original,after);
 let again:Buffer;if(guest){await guest.ensure(()=>steps([{human:"If the guest requests authorization after restart, approve only the same test RSA debugging key. Keep SELinux enforcing and ADB authentication enabled."}]));again=await guest.result();guest.report.rebootOutputSha256=sha(again);guest.report.stagedBundleSha256=sha(stagedBundle!);writeJson(file("android-adb.json"),guest.report);await guest.close();guest=undefined;}else [again]=await binary("GET",p+"/files/"+scenario.resultName);
 assert(again.equals(result));await call("POST",p+"/stop",{body:{},expected:202});await wait(async()=>!(await call("GET",p)).instance,300,"Final stop failed");
 if(!args.retain){await call("DELETE",p,{expected:409});await call("DELETE",p+"?deleteDisks=true",{expected:202,phase:"delete"});path=undefined;}
 await release();await call("DELETE","/keys/"+keyId,{phase:"revoke controller key"});keyId=undefined;
 const proof={profile:args.profile,vmId:created.result.id,architecture:spec.architecture,mediaSha256:args.mediaSha256,auxiliarySha256:args.auxiliarySha256??null,softwareSha256:args.softwareSha256,outputSha256:sha(result),scenarioSha256:fileSha256(args.scenario),traceSha256:fileSha256(h.trace!),runId:process.env.GITHUB_RUN_ID,commit:process.env.GITHUB_SHA,screenMarkersVerified:true,recording:{...decoded,sha256:meta.sha256,bytes:meta.bytes},coldResizeAndFilePersistence:true,instanceUid:uid,resizedInstanceUid:newUid,originalPvcUids:original,resizedPvcUids:after,cpuAfterResize:domain.cpu.cores,retained:args.retain,...win?{}:{challengeSha256:challengeDigest,challengeBytes:challenge.length,resultMode:ANDROID_RESULT_MODE,transferPath:args.adbMode?"authorized-adb-over-private-tunnel":"virtiofs-saf"},...args.adbMode?{guestTransferSha256:fileSha256(file("android-adb.json"))}:{},derivedPresentation:h.presentation(raw,"REAL "+args.profile.toUpperCase()+" SHOWCASE")};
 writeJson(file("verification.json"),proof);
}finally{
 if(guest)try{await guest.close();}catch{console.error("Guest transfer cleanup incomplete");}
 const cleanup:[string,string|undefined,CallOptions][]=[["DELETE",path&&lease?path+"/input-lease":undefined,control()],["POST",rec?rec+"/stop":undefined,{body:{},expected:202}],["DELETE",keyId?"/keys/"+keyId:undefined,{}],["DELETE",path&&!args.retain?path+"?deleteDisks=true":undefined,{expected:202}]];
 for(const [method,p,o] of cleanup)if(p)try{await call(method,p,o);}catch{console.error("Cleanup incomplete:",method,p);}
}
