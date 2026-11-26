import {z} from "zod";
import {ApiError,kube,owned,vmPath,vmiPath,dvPath,pvcPath,type Resource} from "./kube";
import {hasOwner} from "./storage";
import {mediaSpec} from "./spec";
import {mediaStatus} from "./media";
import {desiredUsage,requireAccountCapacity} from "./quota";
import {vmStorageClass,type ManagedStorageClass} from "./storage-class";
import {growthFor,growthState} from "./storage-growth-layout";
import {coldDataDiskPatch,readDataDisks,dataDiskClaim,dataDiskNamePattern,MAX_DATA_DISK_GIB,type DataDisk,type DataDiskRequest} from "./data-disk-layout";
const name=z.string().regex(dataDiskNamePattern),expectedResourceVersion=z.string().min(1).max(128);
export const dataDiskSpec=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("create"),name,sizeGiB:z.number().int().min(1).max(MAX_DATA_DISK_GIB),expectedResourceVersion}),
 z.strictObject({action:z.literal("clone"),name,source:name,sizeGiB:z.number().int().min(1).max(MAX_DATA_DISK_GIB),expectedResourceVersion}),
 z.strictObject({action:z.literal("import"),name,media:mediaSpec,sizeGiB:z.number().int().min(1).max(MAX_DATA_DISK_GIB),expectedResourceVersion}),
 z.strictObject({action:z.literal("attach"),name,expectedResourceVersion}),
 z.strictObject({action:z.literal("detach"),name,expectedResourceVersion})
]);
const namespace=()=>process.env.VM_NAMESPACE??"vm-interface";
export function dataDiskManifest(id:string,account:string,uid:string,d:DataDisk,storageClass:ManagedStorageClass="local-path"){
 return {apiVersion:"cdi.kubevirt.io/v1beta1",kind:"DataVolume",metadata:{name:dataDiskClaim(id,d.name),...(d.source||d.media?{annotations:{"cdi.kubevirt.io/storage.bind.immediate.requested":"true"}}:{}),labels:{"vm-interface.io/account":account,"vm-interface.io/computer":id,"vm-interface.io/data-disk":"true"},ownerReferences:[{apiVersion:"kubevirt.io/v1",kind:"VirtualMachine",name:id,uid,controller:false,blockOwnerDeletion:false}]},spec:{source:d.source?{pvc:{name:dataDiskClaim(id,d.source),namespace:namespace()}}:d.media?{upload:{}}:{blank:{}},storage:{storageClassName:storageClass,accessModes:["ReadWriteOnce"],volumeMode:"Filesystem",resources:{requests:{storage:d.sizeGiB+"Gi"}}}}};
}
async function optional(path:string){try{return await kube("GET",path) as Resource}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function verifiedDisk(id:string,account:string,vm:Resource,d:DataDisk){
 const claim=dataDiskClaim(id,d.name),dv=await optional(dvPath(claim));
 const spec=dv?.spec as {source?:Record<string,unknown>;storage?:{storageClassName?:string;volumeMode?:string;accessModes?:string[];resources?:{requests?:{storage?:string}}}}|undefined;
 const source=spec?.source?.pvc as {name?:string;namespace?:string}|undefined;
 const sourceMatches=!!spec?.source&&Object.keys(spec.source).length===1&&(d.source?source?.name===dataDiskClaim(id,d.source)&&source?.namespace===namespace():d.media?!!spec.source.upload:!!spec.source.blank);
 if(!dv?.metadata?.uid||dv.metadata.name!==claim||dv.metadata.deletionTimestamp||!hasOwner(dv,"VirtualMachine",vm.metadata?.uid)||dv.metadata.labels?.["vm-interface.io/account"]!==account||dv.metadata.labels?.["vm-interface.io/computer"]!==id||dv.metadata.labels?.["vm-interface.io/data-disk"]!=="true"||!sourceMatches||spec?.storage?.storageClassName!==vmStorageClass(vm.spec)||spec.storage.volumeMode!=="Filesystem"||spec.storage.accessModes?.join(",")!=="ReadWriteOnce"||spec.storage.resources?.requests?.storage!==d.sizeGiB+"Gi")throw new ApiError(409,"Data disk missing or ownership/layout not confirmed; refusing recreation");
 const pvc=await optional(pvcPath(claim));
 if(pvc&&(!hasOwner(pvc,"DataVolume",dv.metadata.uid)||pvc.metadata?.deletionTimestamp))throw new ApiError(409,"Data disk PVC ownership not confirmed");
 if((dv.status as {phase?:string}|undefined)?.phase==="Succeeded"&&!pvc)throw new ApiError(409,"Previously imported disk PVC missing; refusing recreation");
 return {dv,pvc};
}
export async function requireDataDisks(id:string,account:string,vm:Resource){
 for(const d of readDataDisks(vm,id))if(d.attached||d.source){
  const {dv,pvc}=await verifiedDisk(id,account,vm,d);
  if(d.media&&!(await mediaStatus(id,account,`data-${d.name}`))?.ready)throw new ApiError(409,"Attached data disk media has not been verified and imported");
  if(d.source&&((dv.status as {phase?:string}|undefined)?.phase!=="Succeeded"||(pvc?.status as {phase?:string}|undefined)?.phase!=="Bound"))throw new ApiError(409,"Offline clone has not converged; start blocked to prevent writes to the source");
 }
}
export async function configureDataDisk(account:string,id:string,r:DataDiskRequest,dryRun=false){
 const vm=await owned(id,account),instance=await optional(vmiPath(id)),{entries,patch}=coldDataDiskPatch(vm,instance,id,r);
 const d=entries.find(x=>x.name===r.name)!;
 const claim=dataDiskClaim(id,r.name),usage=desiredUsage(vm.spec);
 await requireAccountCapacity(account,{...usage,storageGiB:usage.storageGiB+(r.action==="create"||r.action==="clone"||r.action==="import"?d.sizeGiB:0)},id);
 if(r.action==="create"||r.action==="clone"||r.action==="import"){
  if(r.action==="clone"){
   const source=entries.find(x=>x.name===r.source)!;
   const {dv,pvc}=await verifiedDisk(id,account,vm,source);
   const grown=growthFor(vm.spec,dataDiskClaim(id,source.name));
   if(grown&&(d.sizeGiB<grown.sizeGiB||!growthState(vm,grown.claim,pvc)?.pvcCapacityConverged))throw new ApiError(409,"Clone must fit the converged expanded PVC");
   if(source.media&&!(await mediaStatus(id,account,`data-${source.name}`))?.ready)throw new ApiError(409,"Clone source media not verified");
   if((dv.status as {phase?:string}|undefined)?.phase!=="Succeeded"||(pvc?.status as {phase?:string}|undefined)?.phase!=="Bound")throw new ApiError(409,"Clone requires an imported bound source disk");
  }
  if(await optional(dvPath(claim))||await optional(pvcPath(claim)))throw new ApiError(409,"Disk resource name already exists");
  await kube("POST",dvPath("").replace(/\/$/,"")+"?dryRun=All",dataDiskManifest(id,account,vm.metadata!.uid!,d,vmStorageClass(vm.spec)));
 }else {
  await verifiedDisk(id,account,vm,d);
  if(r.action==="attach"&&d.media&&!(await mediaStatus(id,account,`data-${d.name}`))?.ready)throw new ApiError(409,"Import data disk media before attaching");
 }
 let updated:Resource;
 try{updated=await kube("PATCH",vmPath(id)+(dryRun?"?dryRun=All":""),patch,"application/merge-patch+json") as Resource}
 catch(e){if(e instanceof ApiError&&e.status===409)throw new ApiError(409,"VM resource version changed before disk reservation");throw e}
 if((r.action==="create"||r.action==="clone"||r.action==="import")&&!dryRun){
  // Reserve quota first. Never silently retry a partially completed create.
  try{await kube("POST",dvPath("").replace(/\/$/,""),dataDiskManifest(id,account,vm.metadata!.uid!,d,vmStorageClass(vm.spec)))}
  catch{throw new ApiError(502,"Disk reservation persisted; creation outcome uncertain. Inspect storage; do not replay with a new name")}
 }
 return {id,disk:d,claim,dryRun,resourceVersion:updated.metadata?.resourceVersion,warning:"Cold configuration only; detach retains disk and quota; guest and CDI readiness require observation"};
}
