import {z} from "zod";
import {ApiError,kube,owned,pvcPath,dvPath,vmPath,vmiPath,type Resource} from "./kube";
import {assertCold} from "./disk-export";
import {hasOwner,managedDisks} from "./storage";
import {configuredStorageClass,vmStorageClass} from "./storage-class";
import {growthClaim,growthReservations,growthState,planGrowth} from "./storage-growth-layout";
import {desiredUsage,requireAccountCapacity} from "./quota";
export const growthSpec=z.strictObject({disk:z.string().regex(/^(system\.disk|exchange\.disk|[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$/),sizeGiB:z.number().int().min(2).max(64),expectedResourceVersion:z.string().min(1).max(128)});
async function optional(path:string){try{return await kube("GET",path) as Resource}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
export async function configureGrowth(account:string,id:string,r:z.infer<typeof growthSpec>,dryRun=false){
 const vm=await owned(id,account);
 assertCold(vm,await optional(vmiPath(id)));
 if(configuredStorageClass()!=="vm-expandable"||vmStorageClass(vm.spec)!=="vm-expandable")throw new ApiError(422,"Native PVC expansion requires the operator-qualified vm-expandable CSI profile");
 const claim=growthClaim(id,r.disk),ref=managedDisks(vm,id).find(d=>d.name===claim);
 if(!ref)throw new ApiError(404,"Expandable disk not found");
 const pvc=await kube("GET",pvcPath(claim)) as Resource;
 if(ref.mode==="virtiofs"){
  if(!hasOwner(pvc,"VirtualMachine",vm.metadata?.uid)||pvc.metadata?.labels?.["vm-interface.io/account"]!==account||pvc.metadata.labels["vm-interface.io/computer"]!==id)throw new ApiError(409,"Exchange PVC ownership not confirmed");
 }else{
  const dv=await kube("GET",dvPath(claim)) as Resource;
  if(!hasOwner(dv,"VirtualMachine",vm.metadata?.uid)||dv.metadata?.labels?.["vm-interface.io/account"]!==account||dv.metadata.labels["vm-interface.io/computer"]!==id||(dv.status as {phase?:string})?.phase!=="Succeeded"||!hasOwner(pvc,"DataVolume",dv.metadata.uid))throw new ApiError(409,"Populated owned DataVolume required");
 }
 const plan=planGrowth(vm,id,r.disk,pvc,r.sizeGiB,r.expectedResourceVersion),usage=desiredUsage(vm.spec);
 await requireAccountCapacity(account,{...usage,storageGiB:usage.storageGiB+plan.delta},id);
 if(!plan.alreadySubmitted)await kube("PATCH",pvcPath(claim)+"?dryRun=All",plan.pvcPatch,"application/merge-patch+json");
 if(plan.delta>0)await kube("PATCH",vmPath(id)+(dryRun?"?dryRun=All":""),plan.reservationPatch,"application/merge-patch+json");
 if(!dryRun&&!plan.alreadySubmitted){
  // Never reduce an already durable reservation. A fresh idempotency key and
  // the identical target may resume a verified, monotonic PVC patch.
  try{await kube("PATCH",pvcPath(claim),plan.pvcPatch,"application/merge-patch+json")}catch{throw new ApiError(502,"Growth reservation retained; inspect storage and resubmit the same target with a fresh version and key")}
 }
 return {id,claim,sizeGiB:r.sizeGiB,dryRun,submitted:!dryRun,warning:"PVC capacity growth only; wait for CSI/filesystem convergence, and separately validate virtual disk and guest partition/filesystem growth"};
}
export async function requireGrowthSubmitted(vm:Resource){
 for(const r of growthReservations(vm.spec)){
  const pvc=await optional(pvcPath(r.claim));
  if(!growthState(vm,r.claim,pvc)?.submitted)throw new ApiError(409,"Submit reserved PVC growth before starting the VM");
 }
}
