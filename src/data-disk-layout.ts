import {ApiError,type Resource} from "./kube";

export const DATA_DISKS_ANNOTATION="vm-interface.io/data-disks";
export const MAX_DATA_DISKS=4;
export const MAX_DATA_DISK_GIB=8;
export const dataDiskNamePattern=/^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$/;
export type DataDisk={name:string;sizeGiB:number;attached:boolean};
export type DataDiskRequest={action:"create";name:string;sizeGiB:number;expectedResourceVersion:string}|{action:"attach"|"detach";name:string;expectedResourceVersion:string};
type Named={name?:string;disk?:{bus?:string};bootOrder?:number;dataVolume?:{name?:string}};
type Desired={runStrategy?:string;dataVolumeTemplates?:unknown[];template?:{metadata?:{annotations?:Record<string,string>};spec?:{domain?:{devices?:{disks?:Named[]}};volumes?:Named[]}}};
export const dataDiskDevice=(name:string)=>"data-"+name;
export const dataDiskClaim=(id:string,name:string)=>id+"-"+dataDiskDevice(name);
function invalid():never{throw new ApiError(409,"Unrecognized managed data disk layout")}
export function dataDiskDeclarations(raw:unknown):DataDisk[]{
 if(raw===undefined)return [];
 if(typeof raw!=="string"||raw.length>2048)invalid();
 let value:unknown;try{value=JSON.parse(raw)}catch{invalid()}
 if(!Array.isArray(value)||value.length>MAX_DATA_DISKS)invalid();
 const entries:DataDisk[]=value.map((d:unknown)=>{
  if(!d||typeof d!=="object"||Array.isArray(d))invalid();
  const v=d as Record<string,unknown>;
  if(Object.keys(v).length!==3||typeof v.name!=="string"||!dataDiskNamePattern.test(v.name)||typeof v.sizeGiB!=="number"||!Number.isInteger(v.sizeGiB)||v.sizeGiB<1||v.sizeGiB>MAX_DATA_DISK_GIB||typeof v.attached!=="boolean")invalid();
  return {name:v.name,sizeGiB:v.sizeGiB,attached:v.attached};
 });
 if(new Set(entries.map(d=>d.name)).size!==entries.length)invalid();
 return entries;
}
export function readDataDisks(vm:Resource,id:string):DataDisk[]{
 const s=vm.spec as Desired|undefined;
 const raw=s?.template?.metadata?.annotations?.[DATA_DISKS_ANNOTATION];
 const entries=dataDiskDeclarations(raw);
 const disks=s?.template?.spec?.domain?.devices?.disks??[],volumes=s?.template?.spec?.volumes??[];
 if(!Array.isArray(disks)||!Array.isArray(volumes))invalid();
 if(entries.length&&(!s?.dataVolumeTemplates?.length||!/^vm-[a-f0-9]{32}$/.test(id)))invalid();
 const managed=entries.filter(d=>d.attached);
 const ds=disks.filter(d=>d.name?.startsWith("data-")),vs=volumes.filter(v=>v.name?.startsWith("data-"));
 if(ds.length!==managed.length||vs.length!==managed.length)invalid();
 for(const d of managed){
  const device=dataDiskDevice(d.name),dd=ds.filter(x=>x.name===device),vv=vs.filter(x=>x.name===device);
  if(dd.length!==1||vv.length!==1||dd[0].disk?.bus!=="virtio"||dd[0].bootOrder!==undefined||vv[0].dataVolume?.name!==dataDiskClaim(id,d.name))invalid();
 }
 return entries;
}
export function coldDataDiskPatch(vm:Resource,instance:Resource|null,id:string,r:DataDiskRequest){
 const s=vm.spec as Desired|undefined,st=vm.status as {ready?:boolean;created?:boolean;stateChangeRequests?:unknown[]}|undefined;
 if(vm.metadata?.name!==id||!vm.metadata.uid||vm.metadata.deletionTimestamp||vm.metadata.resourceVersion!==r.expectedResourceVersion)throw new ApiError(409,"VM identity or resource version changed");
 if(instance||s?.runStrategy!=="Halted"||st?.ready||st?.created||st?.stateChangeRequests?.length)throw new ApiError(409,"Stop the VM and wait for lifecycle convergence before modifying disks");
 if(!s.dataVolumeTemplates?.length)throw new ApiError(422,"Additional disks require a persistent computer");
 const old=readDataDisks(vm,id),existing=old.find(d=>d.name===r.name);
 if(!dataDiskNamePattern.test(r.name))throw new ApiError(422,"Invalid data disk name");
 let entries:DataDisk[];
 if(r.action==="create"){
  if(existing||old.length>=MAX_DATA_DISKS)throw new ApiError(409,"Disk name exists or disk count limit reached");
  if(!Number.isInteger(r.sizeGiB)||r.sizeGiB<1||r.sizeGiB>MAX_DATA_DISK_GIB)throw new ApiError(422,"Invalid disk size");
  entries=[...old,{name:r.name,sizeGiB:r.sizeGiB,attached:false}];
 }else{
  if(!existing)throw new ApiError(404,"Data disk not found");
  if(existing.attached===(r.action==="attach"))throw new ApiError(409,"Disk already in requested attachment state");
  entries=old.map(d=>d.name===r.name?{...d,attached:r.action==="attach"}:d);
 }
 const device=dataDiskDevice(r.name),disks=s.template?.spec?.domain?.devices?.disks,volumes=s.template?.spec?.volumes;
 if(!Array.isArray(disks)||!Array.isArray(volumes))invalid();
 const updatedDisks=r.action==="attach"?[...disks,{name:device,disk:{bus:"virtio"}}]:r.action==="detach"?disks.filter(d=>d.name!==device):disks;
 const updatedVolumes=r.action==="attach"?[...volumes,{name:device,dataVolume:{name:dataDiskClaim(id,r.name)}}]:r.action==="detach"?volumes.filter(v=>v.name!==device):volumes;
 return {entries,patch:{metadata:{resourceVersion:r.expectedResourceVersion},spec:{template:{metadata:{annotations:{[DATA_DISKS_ANNOTATION]:JSON.stringify(entries)}},spec:{domain:{devices:{disks:updatedDisks}},volumes:updatedVolumes}}}}};
}
