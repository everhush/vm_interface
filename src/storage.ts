import {ApiError,kube,owned,dvPath,pvcPath,type Resource} from "./kube";
import {diskNames} from "./spec";
import {readDataDisks,dataDiskClaim} from "./data-disk-layout";
import {growthState} from "./storage-growth-layout";

type DiskRef={kind:"boot"|"exchange"|"installer"|"auxiliary"|"data";name:string;mode?:"virtiofs";diskName?:string;attached?:boolean;sizeGiB?:number;source?:string};
type Template={metadata?:{name?:string}};
export function managedDisks(vm:Resource,id:string):DiskRef[]{
 const s=vm.spec as {dataVolumeTemplates?:Template[];template?:{metadata?:{annotations?:Record<string,string>};spec?:{architecture?:string;domain?:{devices?:{filesystems?:{name?:string;virtiofs?:object}[]}};volumes?:{name?:string;persistentVolumeClaim?:{claimName?:string}}[]}}}|undefined;
 const templates=s?.dataVolumeTemplates??[];
 const additional=readDataDisks(vm,id).map(d=>({kind:"data" as const,name:dataDiskClaim(id,d.name),diskName:d.name,attached:d.attached,sizeGiB:d.sizeGiB,...(d.source?{source:d.source}:{})}));
 if(!templates.length)return [];
 const names=diskNames(id);
 const shared=s?.template?.metadata?.annotations?.["vm-interface.io/exchange-gib"];
 const auxiliary=s?.template?.metadata?.annotations?.["vm-interface.io/auxiliary-media"]!==undefined;
 const extra=auxiliary?[{kind:"auxiliary" as const,name:id+"-auxiliary"}]:[];
 if(shared!==undefined){
  const tag=s?.template?.metadata?.annotations?.["vm-interface.io/exchange-tag"]??"exchange";
  const fs=s?.template?.spec?.domain?.devices?.filesystems;
  if((tag!=="exchange"&&tag!=="share")||(tag==="share"&&s?.template?.spec?.architecture!=="arm64")||fs?.length!==1||fs[0].name!==tag||!fs[0].virtiofs)throw new ApiError(409,"Unrecognized VirtioFS mount tag");
  const installer=s?.template?.metadata?.annotations?.["vm-interface.io/media-slot"]==="installer";
  const expected=[names.boot,...(installer?[id+"-installer"]:[]),...extra.map(d=>d.name)];
  if(!/^[1-4]$/.test(shared)||templates.length!==expected.length||!expected.every(n=>templates.some(t=>t.metadata?.name===n))||!s?.template?.spec?.volumes?.some(v=>v.name===tag&&v.persistentVolumeClaim?.claimName===names.exchange))throw new ApiError(409,"Unrecognized VirtioFS layout");
  return [{kind:"boot",name:names.boot},{kind:"exchange",name:names.exchange,mode:"virtiofs"},...(installer?[{kind:"installer" as const,name:id+"-installer"}]:[]),...extra,...additional];
 }
 const installer=s?.template?.metadata?.annotations?.["vm-interface.io/media-slot"]==="installer";
 const expected=[names.boot,names.exchange,...(installer?[id+"-installer"]:[]),...extra.map(d=>d.name)];
 if(templates.length!==expected.length || !expected.every(name=>templates.some(t=>t.metadata?.name===name)))throw new ApiError(409,"Unrecognized VM storage layout");
 return [{kind:"boot",name:names.boot},{kind:"exchange",name:names.exchange},...(installer?[{kind:"installer" as const,name:id+"-installer"}]:[]),...extra,...additional];
}
export function hasOwner(resource:Resource,kind:string,uid:string|undefined){
 return !!uid && !!resource.metadata?.ownerReferences?.some(o=>o.kind===kind&&o.uid===uid);
}
export function requireDeleteConfirmation(disks:DiskRef[],confirmed:boolean){
 if(disks.length&&!confirmed)throw new ApiError(409,"Persistent disks will be deleted; explicitly confirm with deleteDisks=true");
}
async function optionalResource(path:string){
 try{return await kube("GET",path) as Resource;}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e;}
}
export async function inspectStorage(id:string,account:string){
 const vm=await owned(id,account), disks=managedDisks(vm,id);
 const volumes=await Promise.all(disks.map(async disk=>{
  const dv=await optionalResource(dvPath(disk.name));
  if(dv&&!hasOwner(dv,"VirtualMachine",vm.metadata?.uid))throw new ApiError(409,"DataVolume ownership not confirmed");
  const pvc=await optionalResource(pvcPath(disk.name));
  if(pvc&&!hasOwner(pvc,"DataVolume",dv?.metadata?.uid)&&!hasOwner(pvc,"VirtualMachine",vm.metadata?.uid))throw new ApiError(409,"PVC ownership not confirmed");
  const ds=dv?.status as {phase?:string;progress?:string}|undefined;
  const ps=pvc?.status as {phase?:string;capacity?:{storage?:string}}|undefined;
  return {...disk,growth:growthState(vm,disk.name,pvc),dataVolumeUid:dv?.metadata?.uid??null,dataVolumePhase:ds?.phase??null,progress:ds?.progress??null,pvcPhase:ps?.phase??null,pvcUid:pvc?.metadata?.uid??null,capacity:ps?.capacity?.storage??null};
 }));
 return {id,mode:disks.length?"persistent":"ephemeral",volumes,deletePolicy:disks.length?"explicit-confirmation-required":"no-persistent-disks"};
}
