import {z} from "zod";
import {ApiError,kube,owned,vmPath,vmiPath,dvPath,pvcPath,type Resource} from "./kube";
import {hasOwner} from "./storage";
import {desiredUsage,requireAccountCapacity} from "./quota";
import {coldDataDiskPatch,readDataDisks,dataDiskClaim,dataDiskNamePattern,MAX_DATA_DISK_GIB,type DataDisk,type DataDiskRequest} from "./data-disk-layout";
const name=z.string().regex(dataDiskNamePattern),expectedResourceVersion=z.string().min(1).max(128);
export const dataDiskSpec=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("create"),name,sizeGiB:z.number().int().min(1).max(MAX_DATA_DISK_GIB),expectedResourceVersion}),
 z.strictObject({action:z.literal("attach"),name,expectedResourceVersion}),
 z.strictObject({action:z.literal("detach"),name,expectedResourceVersion})
]);
export function dataDiskManifest(id:string,account:string,uid:string,d:DataDisk){
 return {apiVersion:"cdi.kubevirt.io/v1beta1",kind:"DataVolume",metadata:{name:dataDiskClaim(id,d.name),labels:{"vm-interface.io/account":account,"vm-interface.io/computer":id,"vm-interface.io/data-disk":"true"},ownerReferences:[{apiVersion:"kubevirt.io/v1",kind:"VirtualMachine",name:id,uid,controller:false,blockOwnerDeletion:false}]},spec:{source:{blank:{}},storage:{storageClassName:"local-path",accessModes:["ReadWriteOnce"],volumeMode:"Filesystem",resources:{requests:{storage:d.sizeGiB+"Gi"}}}}};
}
async function optional(path:string){try{return await kube("GET",path) as Resource}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function verifiedDisk(id:string,account:string,vm:Resource,d:DataDisk){
 const claim=dataDiskClaim(id,d.name),dv=await optional(dvPath(claim));
 const spec=dv?.spec as {source?:Record<string,unknown>;storage?:{storageClassName?:string;volumeMode?:string;accessModes?:string[];resources?:{requests?:{storage?:string}}}}|undefined;
 if(!dv?.metadata?.uid||dv.metadata.name!==claim||dv.metadata.deletionTimestamp||!hasOwner(dv,"VirtualMachine",vm.metadata?.uid)||dv.metadata.labels?.["vm-interface.io/account"]!==account||dv.metadata.labels?.["vm-interface.io/computer"]!==id||dv.metadata.labels?.["vm-interface.io/data-disk"]!=="true"||!spec?.source?.blank||Object.keys(spec.source).length!==1||spec.storage?.storageClassName!=="local-path"||spec.storage.volumeMode!=="Filesystem"||spec.storage.accessModes?.join(",")!=="ReadWriteOnce"||spec.storage.resources?.requests?.storage!==d.sizeGiB+"Gi")throw new ApiError(409,"Data disk missing or ownership/layout not confirmed; refusing recreation");
 const pvc=await optional(pvcPath(claim));
 if(pvc&&(!hasOwner(pvc,"DataVolume",dv.metadata.uid)||pvc.metadata?.deletionTimestamp))throw new ApiError(409,"Data disk PVC ownership not confirmed");
 if((dv.status as {phase?:string}|undefined)?.phase==="Succeeded"&&!pvc)throw new ApiError(409,"Previously imported disk PVC missing; refusing recreation");
 return dv;
}
export async function requireDataDisks(id:string,account:string,vm:Resource){
 for(const d of readDataDisks(vm,id))if(d.attached)await verifiedDisk(id,account,vm,d);
}
export async function configureDataDisk(account:string,id:string,r:DataDiskRequest,dryRun=false){
 const vm=await owned(id,account),instance=await optional(vmiPath(id)),{entries,patch}=coldDataDiskPatch(vm,instance,id,r);
 const d=entries.find(x=>x.name===r.name)!;
 const claim=dataDiskClaim(id,r.name),usage=desiredUsage(vm.spec);
 await requireAccountCapacity(account,{...usage,storageGiB:usage.storageGiB+(r.action==="create"?d.sizeGiB:0)},id);
 if(r.action==="create"){
  if(await optional(dvPath(claim))||await optional(pvcPath(claim)))throw new ApiError(409,"Disk resource name already exists");
  await kube("POST",dvPath("").replace(/\/$/,"")+"?dryRun=All",dataDiskManifest(id,account,vm.metadata!.uid!,d));
 }else await verifiedDisk(id,account,vm,d);
 const updated=await kube("PATCH",vmPath(id)+(dryRun?"?dryRun=All":""),patch,"application/merge-patch+json") as Resource;
 if(r.action==="create"&&!dryRun){
  // Reserve quota first. Never silently retry a partially completed create.
  try{await kube("POST",dvPath("").replace(/\/$/,""),dataDiskManifest(id,account,vm.metadata!.uid!,d))}
  catch{throw new ApiError(502,"Disk reservation persisted; creation outcome uncertain. Inspect storage; do not replay with a new name")}
 }
 return {id,disk:d,claim,dryRun,resourceVersion:updated.metadata?.resourceVersion,warning:"Cold configuration only; detach retains disk and quota; guest and CDI readiness require observation"};
}
