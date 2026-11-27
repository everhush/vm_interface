/** Independently validate retained real CSI growth evidence, not hardware certification. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,statSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {isMain} from "./tooling.ts";
const GIB=1024**3;
export function requireEvidence(ok:unknown,message:string):asserts ok{assert(ok,message);}
export const digest=(data:Buffer)=>createHash("sha256").update(data).digest("hex");
export function capacity(value:string){const m=/^([0-9]+)(Gi|Mi)?$/.exec(value);if(!m)throw Error("Unexpected PVC capacity");const n=Number(m[1])*(m[2]==="Gi"?GIB:m[2]==="Mi"?1024**2:1);if(!Number.isSafeInteger(n))throw Error("Unexpected PVC capacity");return n;}
type PVC={kind:string;name:string;pvcUid:string;pvcPhase:string;capacity:string;dataVolumeUid?:string;mode?:string;growth:{reservedGiB:number;submitted:boolean;pvcCapacityConverged:boolean;guestDiskGrowthVerified:boolean;guestFilesystemGrowthVerified:boolean}};
type Proof={commit:string;runId:string;original:Record<string,PVC>;expanded:Record<string,PVC>;inputSha256:string;guestBeforeBytes:number;guestAfterBytes:number;actualVirtioFsGrowthVerified:boolean;samePvcIdentities:boolean;crossAccountDenied:boolean;quotaReserved:boolean;virtualBootDiskGrowthVerified:boolean;guestBootFilesystemGrowthVerified:boolean};
export function tarMembers(data:Buffer,maxMember=65536){
 const result=new Map<string,Buffer>();let pos=0;
 const str=(b:Buffer)=>b.toString("utf8").split("\0")[0];
 const oct=(b:Buffer)=>{const s=str(b).trim();assert(/^[0-7]+$/.test(s),"Invalid tar integer");return parseInt(s,8);};
 while(pos+512<=data.length){
  const h=data.subarray(pos,pos+512);
  if(h.every(x=>x===0)){assert(data.length-pos>=1024&&data.subarray(pos).every(x=>x===0),"Invalid tar terminator");return result;}
  const expected=oct(h.subarray(148,156)),actual=h.reduce((s,x,i)=>s+(i>=148&&i<156?32:x),0);assert.equal(actual,expected,"Tar checksum mismatch");
  const prefix=str(h.subarray(345,500)),name=(prefix?prefix+"/":"")+str(h.subarray(0,100)),size=oct(h.subarray(124,136));
  assert((h[156]===0||h[156]===48)&&size<=maxMember&&!result.has(name)&&pos+512+size<=data.length,"Unexpected bundle members");
  result.set(name,data.subarray(pos+512,pos+512+size));pos+=512+Math.ceil(size/512)*512;
 }
 throw Error("Incomplete tar");
}
export function verify(root:string,commit?:string){
 const folder=join(root,"csi-growth"),proof=JSON.parse(readFileSync(join(folder,"verification.json"),"utf8")) as Proof;
 assert(/^[a-f0-9]{40}$/.test(proof.commit)&&/^[0-9]+$/.test(String(proof.runId)),"Missing hosted source identity");
 if(commit)assert.equal(proof.commit,commit,"Unexpected source commit");
 for(const flag of ["actualVirtioFsGrowthVerified","samePvcIdentities","crossAccountDenied","quotaReserved"] as const)assert(proof[flag]===true,"Missing "+flag);
 for(const flag of ["virtualBootDiskGrowthVerified","guestBootFilesystemGrowthVerified"] as const)assert(proof[flag]===false,"PVC growth must not be reported as guest boot disk/filesystem growth");
 const old=proof.original,expanded=proof.expanded;
 assert.deepEqual(Object.keys(old).sort(),["boot","exchange"],"Unexpected PVC set");assert.deepEqual(Object.keys(expanded).sort(),["boot","exchange"],"Unexpected PVC set");
 for(const [kind,size] of [["boot",8],["exchange",2]] as const){
  const a=old[kind],b=expanded[kind];
  assert(a.kind===kind&&b.kind===kind&&a.name===b.name&&a.pvcUid&&a.pvcUid===b.pvcUid&&a.pvcPhase==="Bound"&&b.pvcPhase==="Bound","PVC identity or phase changed");
  assert(capacity(a.capacity)<capacity(b.capacity)&&capacity(b.capacity)>=size*GIB,"PVC capacity did not increase");
  assert(b.growth.reservedGiB===size&&b.growth.submitted===true&&b.growth.pvcCapacityConverged===true,"Missing durable growth reservation/convergence");
  assert(b.growth.guestDiskGrowthVerified===false&&b.growth.guestFilesystemGrowthVerified===false,"Unsupported guest growth claim");
 }
 assert(old.boot.dataVolumeUid&&old.boot.dataVolumeUid===expanded.boot.dataVolumeUid,"Boot DataVolume identity changed");
 assert(old.exchange.mode==="virtiofs"&&expanded.exchange.mode==="virtiofs","Wrong exchange mode");
 const challengeHash=proof.inputSha256;
 const measure=(name:string)=>{
  const data=readFileSync(join(folder,name+".bin")),m=/^([0-9]+)\r?\n([a-f0-9]{64})\r?\n?$/.exec(data.toString("ascii"));
  assert(m&&m[2]===challengeHash,"Guest challenge digest/measurement invalid");return {size:Number(m[1]),data};
 };
 const a=measure("before"),b=measure("after"),before=a.size,after=b.size;
 assert(before===proof.guestBeforeBytes&&after===proof.guestAfterBytes&&before>0&&before<=GIB&&after>=before+GIB*3/4&&after<=2*GIB,"Guest capacity did not materially increase");
 const bundle=join(folder,"exchange-bundle.tar");assert(statSync(bundle).size<=1024**2,"Oversized evidence bundle");
 const raw=readFileSync(bundle),members=tarMembers(raw);
 assert.deepEqual([...members.keys()].sort(),["download/after.bin","download/before.bin","manifest.json","upload/challenge.bin"],"Unexpected bundle members");
 const challenge=members.get("upload/challenge.bin")!;assert(challenge.length===4096&&digest(challenge)===challengeHash,"Bundled challenge mismatch");
 assert(members.get("download/before.bin")!.equals(a.data)&&members.get("download/after.bin")!.equals(b.data),"Guest measurement bytes differ from bundle");
 const manifest=JSON.parse(members.get("manifest.json")!.toString("utf8")) as {version:number;scope:string;files:{name:string}[]};
 const expected=[...members.entries()].filter(([name])=>name!=="manifest.json").map(([name,data])=>({name,bytes:data.length,sha256:digest(data),direction:name.split("/")[0]}));
 const byName=(a:{name:string},b:{name:string})=>a.name.localeCompare(b.name);
 assert(manifest.version===1&&manifest.scope==="published-exchange-files-only","Bundle manifest mismatch");assert.deepEqual(manifest.files.sort(byName),expected.sort(byName),"Bundle manifest mismatch");
 for(const [filename,claim] of [["csi-admission-readiness.txt","vm-growth-admission-sentinel"],["csi-denied-patch.txt","vm-recordings"]]){
  const data=readFileSync(join(root,filename),"utf8");assert(data.includes(claim)&&data.includes("ValidatingAdmissionPolicy 'vm-pvc-growth'")&&data.includes("denied request"),"Admission denial missing: "+claim);
 }
 const storage=JSON.parse(readFileSync(join(root,"csi-storageclass.json"),"utf8"));assert(storage.allowVolumeExpansion===true&&storage.provisioner==="rawfile.csi.openebs.io"&&storage.metadata.name==="vm-expandable","Wrong expandable storage backend");
 const rows=readFileSync(join(folder,"http-trace.jsonl"),"utf8").split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x) as {status:number;expected:number;phase?:string;method:string;path:string});
 assert(rows.length&&rows.every(row=>row.status===row.expected&&Object.keys(row).every(k=>["elapsedMs","method","path","status","expected","responseMs","phase"].includes(k))),"Trace contains failed requests or unexpected fields");
 assert.equal(rows.filter(row=>row.phase==="growth submit"&&row.status===202).length,2,"Two successful growth requests not observed");
 const denials=new Set(rows.filter(row=>row.method==="PATCH"&&row.path.endsWith("/storage")).map(row=>row.status));
 assert([404,409,422].every(x=>denials.has(x)),"Missing ownership, version and shrink denials");
 return {commit:proof.commit,runId:proof.runId,guestBeforeBytes:before,guestAfterBytes:after,bundleSha256:digest(raw),httpCalls:rows.length,hardwareCertifiedByVerifier:false,virtualBootDiskGrowthVerified:false,guestBootFilesystemGrowthVerified:false};
}
if(isMain(import.meta.url)){
 const {values}=parseArgs({options:{root:{type:"string"},commit:{type:"string"}}});if(!values.root)throw Error("--root required");
 console.log(JSON.stringify(verify(values.root,values.commit),null,2));
}
