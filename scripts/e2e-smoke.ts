/** Real API lifecycle, authorization, idempotency, and native VM screenshot checks. */
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,appendFileSync} from "node:fs";
import {inflateSync,crc32} from "node:zlib";
import {client,key,wait,sleep,writeJson} from "./api-client.ts";
const {call,request,B}=client();mkdirSync("evidence",{recursive:true});
async function capture(path:string,token?:string,expected=200,scheme="Bearer"){
 const r=await request("GET",path,{token,expected,scheme});
 if(expected!==200)return null;
 assert.equal(r.headers.get("content-type")?.split(";")[0],"image/png");assert.equal(r.headers.get("cache-control"),"no-store");return r.data;
}
export function verifyPng(png:Buffer|null){
 assert(png&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.length<=8*1024**2);
 let pos=8,width=0,height=0,ended=false;const chunks:Buffer[]=[];
 while(pos<png.length){
  assert(pos+12<=png.length);const size=png.readUInt32BE(pos),kind=png.subarray(pos+4,pos+8).toString("ascii");
  assert(pos+12+size<=png.length);const data=png.subarray(pos+8,pos+8+size);
  assert.equal(crc32(png.subarray(pos+4,pos+8+size)),png.readUInt32BE(pos+8+size));
  pos+=size+12;
  if(kind==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);}
  if(kind==="IDAT")chunks.push(data);
  if(kind==="IEND"){ended=true;assert(size===0&&pos===png.length);break;}
 }
 assert(ended&&width>0&&width<=8192&&height>0&&height<=8192&&chunks.length);
 assert(inflateSync(Buffer.concat(chunks),{maxOutputLength:128*1024**2}).length>0);
 return {width,height,bytes:png.length};
}
type Condition={type?:string;status?:string;reason?:string};
type State={id?:string;status?:{printableStatus?:string;conditions?:Condition[];stateChangeRequests?:unknown[];created?:boolean}|null;instance:null|{metadata:{uid:string};status:{phase:string;conditions?:Condition[]};spec:{volumes:{containerDisk?:{image:string}}[];domain:{cpu:{cores:number};memory?:{guest:string}};architecture:string}};desired:{runStrategy:string;template:{spec:{domain:{cpu:{cores:number}}}}};resourceVersion:string};
function record(label:string,state:State){
 const inst=state.instance,vs=state.status,s=inst?.status;
 const conditions=(c:Condition[]|undefined)=>(c??[]).map(({type,status,reason})=>({type:type??null,status:status??null,reason:reason??null}));
 const summary={id:state.id??null,vmStatus:vs?.printableStatus??null,vmConditions:conditions(vs?.conditions),vmiUid:inst?.metadata.uid??null,vmiPhase:s?.phase??null,vmiConditions:conditions(s?.conditions)};
 appendFileSync("evidence/api-lifecycle.jsonl",JSON.stringify({stage:label,time:Date.now()/1000,...summary})+"\n");return summary;
}
async function waitFor(label:string,fn:(state:State)=>unknown,seconds=360){
 let previous="";const end=performance.now()+seconds*1000;
 while(performance.now()<end){const state:State=await call("GET","/computers/"+vm),summary=record(label,state),encoded=JSON.stringify(summary);if(encoded!==previous){console.log(label,summary);previous=encoded;}if(fn(state))return state;await sleep(5);}
 throw Error(label+" did not converge; last state: "+previous);
}
const running=(s:State)=>s.instance?.status.phase==="Running";
const spec={version:1,name:"ci-smoke",architecture:"amd64",cpu:1,memoryMiB:512,image:"cirros-smoke"};
await call("GET","/schema",{token:"invalid",expected:401});await call("GET","/images",{token:"invalid",expected:401});
const images=await call("GET","/images");assert(images.length===2&&images[0].id==="cirros-smoke"&&images[0].architecture==="amd64");assert(images[0].image.endsWith("@"+images[0].digest));writeJson("evidence/image-catalog.json",images);
const schema=await call("GET","/schema"),contract=await call("GET","/openapi.json");assert.equal(contract.openapi,"3.1.0");delete schema.$schema;assert.deepEqual(contract.components.schemas.ComputerSpec,schema);
await call("GET","/openapi.json",{token:"invalid",expected:401});
await call("POST","/computers/plan",{body:{...spec,hostPath:"/"},expected:422});await call("POST","/computers/plan",{body:{...spec,architecture:"arm64"},expected:422});await call("POST","/computers/plan",{body:spec});
const advanced={version:1,name:spec.name,image:spec.image,kubevirt:{architecture:"amd64",domain:{cpu:{cores:1},resources:{requests:{memory:"512Mi"}}}}};
assert.deepEqual((await call("POST","/computers/plan",{body:advanced})).validated,spec);
await call("POST","/computers/plan",{body:{...advanced,kubevirt:{...advanced.kubevirt,volumes:[{hostDisk:{path:"/"}}]}},expected:422});await call("GET","/schema/advanced");
await call("POST","/computers",{body:spec,expected:400});
assert.deepEqual((await call("GET","/account/quota")).usage,{computers:0,cpu:0,memoryMiB:0,storageGiB:0});
const reserved:string[]=[];
try{
 const large={...spec,cpu:4,memoryMiB:4096};
 for(let i=0;i<2;i++){const c=await call("POST","/computers",{body:{...large,name:"quota-"+i},idem:key(),expected:202});reserved.push(c.result.id);}
 const usage=(await call("GET","/account/quota")).usage;assert.deepEqual(usage,{computers:2,cpu:8,memoryMiB:8192,storageGiB:0});assert.equal((await call("GET","/account/quota",{token:B})).usage.cpu,0);
 await call("POST","/computers/plan",{body:spec,expected:409});const rejectedKey=key(),rejected=await call("POST","/computers",{body:spec,idem:rejectedKey,expected:409});assert.deepEqual(await call("POST","/computers",{body:spec,idem:rejectedKey,expected:409}),rejected);writeJson("evidence/account-quota.json",usage);
}finally{for(const id of reserved)await call("DELETE","/computers/"+id,{idem:key(),expected:202});}
await wait(async()=>(await call("GET","/account/quota")).usage.computers===0,120,"Quota reservations not released after VM deletion",3);
const k=key(),created=await call("POST","/computers",{body:spec,idem:k,expected:202});const vm:string=created.result.id;
const path="/computers/"+vm;
try{
 assert.deepEqual(await call("POST","/computers",{body:spec,idem:k,expected:202}),created);assert.deepEqual(await call("POST","/computers",{body:advanced,idem:k,expected:202}),created);
 await call("POST","/computers",{body:{...spec,cpu:2},idem:k,expected:409});assert.equal((await call("GET","/operations/"+created.operationId)).status,"submitted");
 const issued=await call("POST","/keys",{body:{label:"ci-read",permission:"read",ttlSeconds:600},expected:201}),readKey=issued.token;
 assert.equal((await call("GET",path,{token:readKey})).id,vm);
 assert((await call("GET","/keys")).every((x:object)=>!("token" in x)&&!("tokenHash" in x)));assert((await call("GET","/keys",{token:B})).every((x:{id:string})=>x.id!==issued.id));
 await call("GET","/keys",{token:readKey,expected:403});await call("POST",path+"/start",{token:readKey,body:{},idem:key(),expected:403});await call("DELETE","/keys/"+issued.id,{token:B,expected:404});
 const rotated=await call("POST","/keys/"+issued.id+"/rotate",{expected:201});await call("GET",path,{token:readKey,expected:401});assert.equal((await call("GET",path,{token:rotated.token})).id,vm);await call("DELETE","/keys/"+rotated.id);await call("GET",path,{token:rotated.token,expected:401});
 const managed=await call("POST","/keys",{body:{label:"ci-manage",permission:"manage",ttlSeconds:600},expected:201});await call("POST","/keys",{token:managed.token,body:{label:"escalation",permission:"manage",ttlSeconds:600},expected:403});await call("POST","/computers/plan",{token:managed.token,body:spec});await call("DELETE","/keys/"+managed.id);writeJson("evidence/account-key-checks.json",{rotation:true,revocation:true,readOnly:true,tenantIsolation:true});
 await call("GET",path,{token:B,expected:404});await capture(path+"/screenshot",B,404);await capture(path+"/screenshot","invalid",401);await capture(path+"/screenshot",undefined,409);
 const halted=await call("GET",path+"/guest");assert(halted.available===false&&halted.console.supported===false);assert.equal((await call("GET",path+"/storage")).mode,"ephemeral");await call("GET",path+"/storage",{token:B,expected:404});
 assert((await call("GET","/computers",{token:B})).every((x:{id:string})=>x.id!==vm));await call("GET","/operations/"+created.operationId,{token:B,expected:404});
 for(const action of ["start","stop","restart"])await call("POST",path+"/"+action,{token:B,body:{},idem:key(),expected:404});
 const deniedKey=key(),denied=await call("DELETE",path,{token:B,idem:deniedKey,expected:404});assert.deepEqual(await call("DELETE",path,{token:B,idem:deniedKey,expected:404}),denied);
 await call("POST",path+"/start",{body:{},idem:key(),expected:202});const before=await waitFor("first-start",running),originalUid=before.instance!.metadata.uid;
 const png=await capture(path+"/screenshot");writeJson("evidence/guest-display.json",verifyPng(png));writeFileSync("evidence/guest-display.png",png!);
 const tickets=path+"/console-tickets";await call("POST",tickets,{token:B,expected:404});const grant=await call("POST",tickets,{expected:201});assert(grant.scope==="screenshot-only"&&grant.instanceUid===originalUid&&grant.authorizationScheme==="Console");const displayToken=grant.token;
 assert((await call("GET",tickets)).every((x:object)=>!("token" in x)&&!("tokenHash" in x)));verifyPng(await capture(path+"/screenshot",displayToken,200,"Console"));await capture("/computers/vm-"+"0".repeat(32)+"/screenshot",displayToken,401,"Console");await call("GET","/account",{token:displayToken,scheme:"Console",expected:401});await call("DELETE",tickets+"/"+grant.id,{token:B,expected:404});await call("DELETE",tickets+"/"+grant.id);await capture(path+"/screenshot",displayToken,401,"Console");writeJson("evidence/display-ticket-checks.json",{scope:"screenshot-only",crossVmDenied:true,revokedDenied:true});await capture(path+"/screenshot",B,404);
 const guest=await call("GET",path+"/guest");assert(guest.available&&guest.phase==="Running"&&guest.ready===true&&guest.evidenceLevel==="kubevirt-status-only"&&guest.console.supported===true&&guest.console.reason.includes("authorized ticket"));writeJson("evidence/guest-observation.json",guest);
 await call("PATCH",path+"/hardware",{body:{cpu:2,memoryMiB:768,expectedResourceVersion:before.resourceVersion},idem:key(),expected:409});
 assert.equal(before.instance!.spec.volumes[0].containerDisk!.image,images[0].image);assert.equal(before.instance!.spec.domain.cpu.cores,spec.cpu);assert.equal(before.instance!.spec.architecture,spec.architecture);
 await call("POST",path+"/restart",{body:{},idem:key(),expected:202});await waitFor("restart",s=>s.instance&&s.instance.metadata.uid!==originalUid&&running(s));writeJson("evidence/running.json",before);
 await call("POST",path+"/stop",{body:{},idem:key(),expected:202});await waitFor("stop",s=>s.instance===null);await capture(path+"/screenshot",undefined,409);
 const stopped=await waitFor("halted-config-ready",s=>s.instance===null&&s.desired.runStrategy==="Halted"&&!s.status?.stateChangeRequests?.length&&!s.status?.created);
 const hw={cpu:2,memoryMiB:768,expectedResourceVersion:stopped.resourceVersion};await call("PATCH",path+"/hardware",{token:B,body:hw,idem:key(),expected:404});await call("PATCH",path+"/hardware",{body:{...hw,cpu:100},idem:key(),expected:422});await call("PATCH",path+"/hardware",{body:{...hw,expectedResourceVersion:"0"},idem:key(),expected:409});const planned=await call("POST",path+"/hardware/plan",{body:hw});assert(planned.dryRun&&planned.desired.template.spec.domain.cpu.cores===2);
 const unchanged=await call("GET",path);assert.equal(unchanged.desired.template.spec.domain.cpu.cores,1);hw.expectedResourceVersion=unchanged.resourceVersion;const resizeKey=key(),resized=await call("PATCH",path+"/hardware",{body:hw,idem:resizeKey,expected:202});assert.deepEqual(await call("PATCH",path+"/hardware",{body:hw,idem:resizeKey,expected:202}),resized);
 await call("POST",path+"/start",{body:{},idem:key(),expected:202});const after=await waitFor("second-start",running),domain=after.instance!.spec.domain;assert.equal(domain.cpu.cores,2);assert.equal(domain.memory?.guest,"768Mi");writeJson("evidence/cold-resize.json",{before:before.instance!.spec.domain,after:domain,vm});
}finally{try{record("pre-delete",await call("GET",path));}finally{await call("DELETE",path,{idem:key(),expected:202});}}
await wait(async()=>(await call("GET","/computers")).every((x:{id:string})=>x.id!==vm),120,"Deleted VM remains visible",3);await call("GET",path,{expected:404});
console.log("Lifecycle and account-isolation smoke passed; guest desktop/boot verification is NOT covered.");
