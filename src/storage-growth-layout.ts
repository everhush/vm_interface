import {ApiError,type Resource} from "./kube";
import {dataDiskDeclarations,dataDiskClaim,DATA_DISKS_ANNOTATION,dataDiskNamePattern,MAX_DATA_DISK_GIB} from "./data-disk-layout";
import {systemMaxGiB} from "./media-config";
export const GROWTH_ANNOTATION="vm-interface.io/pvc-growth";
type Reservation={claim:string;sizeGiB:number;pvcUid:string};
type Desired={dataVolumeTemplates?:{metadata?:{name?:string};spec?:{storage?:{resources?:{requests?:{storage?:string}}}}}[];template?:{metadata?:{labels?:Record<string,string>;annotations?:Record<string,string>}}};
export function storageQuantityBytes(value:unknown):number{
 if(typeof value!=="string")throw new ApiError(409,"Unrecognized storage capacity");
 const m=/^(\d+)(Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(value);
 if(!m)throw new ApiError(409,"Unrecognized storage capacity");
 const scale:Record<string,number>={"":1,Ki:1024,Mi:1024**2,Gi:1024**3,Ti:1024**4,k:1000,M:1000**2,G:1000**3,T:1000**4};
 const n=Number(m[1])*scale[m[2]||""];
 if(!Number.isSafeInteger(n)||n<=0)throw new ApiError(409,"Unrecognized storage capacity");
 return n;
}
function baseDisks(value:unknown){
 const s=value as Desired,id=s?.template?.metadata?.labels?.["vm-interface.io/computer"]??"",annotations=s?.template?.metadata?.annotations;
 const base=new Map<string,{sizeGiB:number;maxGiB:number}>();
 if(!/^vm-[a-f0-9]{32}$/.test(id))throw new ApiError(409,"Unrecognized growth owner");
 const add=(name:string,sizeGiB:number,maxGiB:number)=>{if(base.has(name)||!Number.isSafeInteger(sizeGiB)||sizeGiB<1||sizeGiB>maxGiB)throw new ApiError(409,"Unrecognized growth capacity");base.set(name,{sizeGiB,maxGiB})};
 for(const t of s.dataVolumeTemplates??[]){
  const name=t.metadata?.name;
  if(name===id+"-boot"||name===id+"-exchange")add(name,storageQuantityBytes(t.spec?.storage?.resources?.requests?.storage)/1024**3,name.endsWith("-boot")?64:4);
 }
 const shared=annotations?.["vm-interface.io/exchange-gib"];if(shared!==undefined)add(id+"-exchange",Number(shared),4);
 for(const d of dataDiskDeclarations(annotations?.[DATA_DISKS_ANNOTATION]))add(dataDiskClaim(id,d.name),d.sizeGiB,MAX_DATA_DISK_GIB);
 return base;
}
export function growthReservations(value:unknown):Reservation[]{
 const raw=(value as Desired|undefined)?.template?.metadata?.annotations?.[GROWTH_ANNOTATION];
 if(raw===undefined)return [];
 if(typeof raw!=="string"||raw.length>4096)throw new ApiError(409,"Unrecognized growth reservation");
 let rows:unknown;try{rows=JSON.parse(raw)}catch{throw new ApiError(409,"Unrecognized growth reservation")}
 const base=baseDisks(value);
 if(!Array.isArray(rows)||rows.length>6)throw new ApiError(409,"Unrecognized growth reservation");
 const seen=new Set<string>();
 return rows.map((row:unknown)=>{
  if(!row||typeof row!=="object"||Array.isArray(row))throw new ApiError(409,"Unrecognized growth reservation");
  const v=row as Partial<Reservation>,d=typeof v.claim==="string"?base.get(v.claim):undefined;
  if(Object.keys(v).length!==3||typeof v.claim!=="string"||seen.has(v.claim)||!d||typeof v.pvcUid!=="string"||!/^[A-Za-z0-9-]{1,128}$/.test(v.pvcUid)||typeof v.sizeGiB!=="number"||!Number.isInteger(v.sizeGiB)||v.sizeGiB<=d.sizeGiB||v.sizeGiB>d.maxGiB)throw new ApiError(409,"Unrecognized growth reservation");
  seen.add(v.claim);return {claim:v.claim,sizeGiB:v.sizeGiB,pvcUid:v.pvcUid};
 });
}
export function growthQuotaDelta(spec:unknown){
 const rows=growthReservations(spec);if(!rows.length)return 0;const base=baseDisks(spec);
 return rows.reduce((total,v)=>total+v.sizeGiB-base.get(v.claim)!.sizeGiB,0);
}
export function growthFor(spec:unknown,claim:string){return growthReservations(spec).find(v=>v.claim===claim)}
export function growthClaim(id:string,disk:string){
 if(disk==="system.disk")return id+"-boot";
 if(disk==="exchange.disk")return id+"-exchange";
 if(!dataDiskNamePattern.test(disk))throw new ApiError(422,"Invalid disk selector");
 return dataDiskClaim(id,disk);
}
export function planGrowth(vm:Resource,id:string,disk:string,pvc:Resource,sizeGiB:number,expectedResourceVersion:string){
 if(vm.metadata?.name!==id||!vm.metadata.uid||vm.metadata.deletionTimestamp||vm.metadata.resourceVersion!==expectedResourceVersion)throw new ApiError(409,"VM identity or resource version changed");
 const claim=growthClaim(id,disk),base=baseDisks(vm.spec).get(claim),previous=growthFor(vm.spec,claim);
 if(!base)throw new ApiError(404,"Expandable disk not found");
 if(!pvc.metadata?.uid||pvc.metadata.name!==claim||pvc.metadata.deletionTimestamp||!pvc.metadata.resourceVersion)throw new ApiError(409,"PVC identity unavailable");
 if(previous&&previous.pvcUid!==pvc.metadata.uid)throw new ApiError(409,"Reserved PVC identity changed");
 const max=claim===id+"-boot"?Math.min(base.maxGiB,systemMaxGiB):base.maxGiB;
 if(!Number.isInteger(sizeGiB)||sizeGiB<=base.sizeGiB||sizeGiB>max||previous&&sizeGiB<previous.sizeGiB)throw new ApiError(422,"Growth must increase reserved capacity within the disk limit");
 const p=pvc.spec as {storageClassName?:string;volumeMode?:string;resources?:{requests?:{storage?:string}}};
 const status=pvc.status as {phase?:string;capacity?:{storage?:string}}|undefined;
 if(p.storageClassName!=="vm-expandable"||p.volumeMode!=="Filesystem"||status?.phase!=="Bound")throw new ApiError(422,"Bound filesystem PVC on the operator expansion profile required");
 const requested=storageQuantityBytes(p.resources?.requests?.storage),target=sizeGiB*1024**3;
 if(requested>target||requested===target&&previous?.sizeGiB!==sizeGiB)throw new ApiError(422,"PVC capacity may not shrink or be reserved retroactively");
 if(previous&&requested<previous.sizeGiB*1024**3&&sizeGiB!==previous.sizeGiB)throw new ApiError(409,"Submit the existing reservation before increasing it");
 if(previous&&sizeGiB>previous.sizeGiB&&!growthState(vm,claim,pvc)?.pvcCapacityConverged)throw new ApiError(409,"Wait for previous PVC growth convergence");
 const delta=sizeGiB-(previous?.sizeGiB??base.sizeGiB);
 const entries=[...growthReservations(vm.spec).filter(v=>v.claim!==claim),{claim,sizeGiB,pvcUid:pvc.metadata.uid}];
 return {claim,sizeGiB,delta,alreadySubmitted:requested===target,reservationPatch:{metadata:{resourceVersion:expectedResourceVersion},spec:{template:{metadata:{annotations:{[GROWTH_ANNOTATION]:JSON.stringify(entries)}}}}},pvcPatch:{metadata:{resourceVersion:pvc.metadata.resourceVersion},spec:{resources:{requests:{storage:sizeGiB+"Gi"}}}}};
}
export function growthState(vm:Resource,claim:string,pvc:Resource|null){
 const r=growthFor(vm.spec,claim);if(!r)return null;
 if(!pvc||pvc.metadata?.uid!==r.pvcUid)throw new ApiError(409,"Reserved PVC identity changed");
 const requested=storageQuantityBytes((pvc.spec as {resources?:{requests?:{storage?:string}}})?.resources?.requests?.storage),capacity=(pvc.status as {capacity?:{storage?:string};conditions?:{type?:string;status?:string}[]}|undefined);
 const target=r.sizeGiB*1024**3;
 if(requested>target)throw new ApiError(409,"PVC request exceeds reserved capacity");
 const filesystemPending=capacity?.conditions?.some(c=>c.status==="True"&&["Resizing","FileSystemResizePending"].includes(c.type??""))??false;
 return {reservedGiB:r.sizeGiB,submitted:requested===target,pvcCapacityConverged:requested===target&&!!capacity?.capacity?.storage&&storageQuantityBytes(capacity.capacity.storage)>=target&&!filesystemPending,guestDiskGrowthVerified:false,guestFilesystemGrowthVerified:false};
}
