/** Real CDI/PVC identity and attachment via the API, not guest-written persistence. */
import assert from "node:assert/strict";
import {mkdirSync,appendFileSync} from "node:fs";
import {client,key,wait,sleep} from "./api-client.ts";
const {call,B}=client();
mkdirSync("evidence",{recursive:true});
type Volume={kind:string;pvcUid:string;dataVolumePhase:string;pvcPhase:string;name:string};
type Storage={volumes:Volume[]};
type State={instance:null|{status:{phase:string};spec:{volumes:{dataVolume?:{name:string}}[]}}};
const identities=(storage:Storage)=>Object.fromEntries(storage.volumes.map(v=>[v.kind,v.pvcUid]));
const ready=(state:State,storage:Storage)=>state.instance?.status.phase==="Running"&&storage.volumes.length===2&&storage.volumes.every(v=>v.dataVolumePhase==="Succeeded"&&v.pvcPhase==="Bound"&&v.pvcUid);
const spec={version:1,name:"ci-persistent",architecture:"amd64",cpu:1,memoryMiB:512,image:"cirros-smoke",storage:{systemGiB:2,exchangeGiB:1}};
await call("POST","/computers/plan",{body:spec});
await call("POST","/computers/plan",{body:{...spec,storage:{systemGiB:20,exchangeGiB:1}},expected:422});
const idem=key(),created=await call("POST","/computers",{body:spec,idem,expected:202}),vm=created.result.id,path="/computers/"+vm;
async function observe(label:string,check:(state:State,storage:Storage)=>unknown,seconds=600){
 const end=performance.now()+seconds*1000;let last:unknown=null;
 while(performance.now()<end){
  const state:State=await call("GET",path),storage:Storage=await call("GET",path+"/storage");
  last={stage:label,vmiPhase:state.instance?.status.phase??null,storage};
  appendFileSync("evidence/persistent-storage.jsonl",JSON.stringify(last)+"\n");
  if(check(state,storage))return [state,storage] as const;
  await sleep(5);
 }
 throw Error(label+" failed: "+JSON.stringify(last));
}
try{
 assert.deepEqual(await call("POST","/computers",{body:spec,idem,expected:202}),created);
 await call("GET",path+"/storage",{token:B,expected:404});await call("DELETE",path+"?deleteDisks=true",{token:B,idem:key(),expected:404});await call("DELETE",path,{idem:key(),expected:409});
 await call("POST",path+"/start",{body:{},idem:key(),expected:202});
 const [state,storage]=await observe("persistent-start",ready),original=identities(storage);
 assert.equal(new Set(Object.values(original)).size,2);
 assert.deepEqual(new Set(storage.volumes.map(v=>v.name)),new Set(state.instance!.spec.volumes.flatMap(v=>v.dataVolume?[v.dataVolume.name]:[])));
 await call("POST",path+"/stop",{body:{},idem:key(),expected:202});
 const [,stopped]=await observe("persistent-stop",(s,d)=>s.instance===null&&Object.entries(original).every(([k,v])=>identities(d)[k]===v)&&d.volumes.length===2);
 assert(stopped.volumes.every(v=>v.pvcPhase==="Bound"));
 await call("POST",path+"/start",{body:{},idem:key(),expected:202});
 const [,restarted]=await observe("persistent-restart",ready);assert.deepEqual(identities(restarted),original);
}finally{
 const deleted=await call("DELETE",path+"?deleteDisks=true",{idem:key(),expected:202});assert.deepEqual(new Set(deleted.result.affectedDisks),new Set([vm+"-boot",vm+"-exchange"]));
}
await wait(async()=>(await call("GET","/computers")).every((x:{id:string})=>x.id!==vm),180,"Persistent VM still present",3);
await call("GET",path+"/storage",{expected:404});
console.log("Persistent CDI system/exchange volume identity survived stop/start; guest data not verified.");
