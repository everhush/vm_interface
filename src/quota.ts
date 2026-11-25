import {sql} from "drizzle-orm";
import {database} from "./db";
import {ApiError,list} from "./kube";
import type {ComputerSpec} from "./spec";
import {dataDiskDeclarations,DATA_DISKS_ANNOTATION} from "./data-disk-layout";
import {accountMaxStorageGiB,installerGiB} from "./media-config";

export const limits={computers:4,cpu:8,memoryMiB:8192,storageGiB:accountMaxStorageGiB} as const;
export type Usage={computers:number;cpu:number;memoryMiB:number;storageGiB:number};
export const emptyUsage=():Usage=>({computers:0,cpu:0,memoryMiB:0,storageGiB:0});
export function addUsage(a:Usage,b:Usage):Usage{
 return {computers:a.computers+b.computers,cpu:a.cpu+b.cpu,memoryMiB:a.memoryMiB+b.memoryMiB,storageGiB:a.storageGiB+b.storageGiB};
}
// Accept integral byte quantities in canonical Kubernetes binary/decimal units.
// Unknown layouts fail closed instead of silently undercounting capacity.
function quantity(value:unknown,unit:number){
 if(typeof value!=="string")throw new ApiError(409,"Unrecognized reserved resource quantity");
 const m=/^(\d+)(Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(value);
 if(!m)throw new ApiError(409,"Unrecognized reserved resource quantity");
 const scales:Record<string,number>={"":1,Ki:1024,Mi:1024**2,Gi:1024**3,Ti:1024**4,k:1000,M:1000**2,G:1000**3,T:1000**4};
 const bytes=Number(m[1])*scales[m[2]||""];
 if(!Number.isSafeInteger(bytes)||bytes<=0)throw new ApiError(409,"Unrecognized reserved resource quantity");
 return Math.ceil(bytes/unit);
}
type Desired={template?:{metadata?:{annotations?:Record<string,string>};spec?:{domain?:{cpu?:{cores?:number;sockets?:number;threads?:number};resources?:{requests?:{memory?:string}}}}};dataVolumeTemplates?:{spec?:{storage?:{resources?:{requests?:{storage?:string}}}}}[]};
export function desiredUsage(value:unknown):Usage{
 const d=value as Desired|undefined;
 const domain=d?.template?.spec?.domain, cpu=domain?.cpu;
 if(!cpu||!Number.isSafeInteger(cpu.cores)||!cpu.cores||cpu.cores<1||(cpu.sockets??1)!==1||(cpu.threads??1)!==1)throw new ApiError(409,"Unrecognized reserved CPU topology");
 const memoryMiB=quantity(domain?.resources?.requests?.memory,1024**2);
 const shared=d?.template?.metadata?.annotations?.["vm-interface.io/exchange-gib"];
 if(shared!==undefined&&!/^[1-4]$/.test(shared))throw new ApiError(409,"Unrecognized exchange reservation");
 const extra=dataDiskDeclarations(d?.template?.metadata?.annotations?.[DATA_DISKS_ANNOTATION]).reduce((n,v)=>n+v.sizeGiB,0);
 const storageGiB=extra+Number(shared??0)+(d?.dataVolumeTemplates??[]).reduce((n,v)=>n+quantity(v.spec?.storage?.resources?.requests?.storage,1024**3),0);
 return {computers:1,cpu:cpu.cores,memoryMiB,storageGiB};
}
export function specUsage(s:ComputerSpec):Usage{
 return {computers:1,cpu:s.cpu,memoryMiB:s.memoryMiB,storageGiB:s.storage?s.storage.systemGiB+s.storage.exchangeGiB+(s.auxiliaryDisk?.sizeGiB??0)+(s.image==="uploaded-installer"?installerGiB(s.media!.bytes):0):0};
}
export function requireCapacity(usage:Usage){
 for(const k of Object.keys(limits) as (keyof Usage)[]){
  if(!Number.isSafeInteger(usage[k])||usage[k]<0||usage[k]>limits[k])throw new ApiError(409,"Account quota exceeded: "+k);
 }
}
export async function quota(account:string,excludeId?:string){
 const resources=await list(account);
 const usage=resources.filter(x=>x.id!==excludeId||excludeId===undefined).reduce((sum,x)=>addUsage(sum,desiredUsage(x.desired)),emptyUsage());
 return {limits,usage};
}
export async function requireAccountCapacity(account:string,requested:Usage,excludeId?:string){
 const current=await quota(account,excludeId);
 requireCapacity(addUsage(current.usage,requested));
}
// Serialize reservations across API replicas. Always acquire account lock
// before a VM-specific lock. No other account operation takes the reverse order.
export async function withAccountLock<T>(account:string,run:()=>Promise<T>,vmId?:string):Promise<T>{
 return database().transaction(async tx=>{
  const rows=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:quota:"+account},0)) AS locked`);
  if(rows[0]?.locked!==true)throw new ApiError(409,"Another account reservation is in progress; inspect state and retry with a new idempotency key");
  if(vmId!==undefined){
   if(!/^vm-[a-f0-9]{32}$/.test(vmId))throw new ApiError(404,"Computer not found");
   const vmRows=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:"+vmId},0)) AS locked`);
   if(vmRows[0]?.locked!==true)throw new ApiError(409,"Another VM mutation is in progress");
  }
  return run();
 });
}
