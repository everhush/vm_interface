import {and,eq} from "drizzle-orm";
import {database,operations} from "./db";
import {ApiError,kube,vmPath,vmiPath,dvPath,pvcPath,type Resource} from "./kube";
import {mediaStatus,isMediaSlot} from "./media";
import {bootPreference,installerTray} from "./boot";
import {inspectStorage} from "./storage";
type Row=typeof operations.$inferSelect;
type Intent={action?:string;computerId?:string|null;cpu?:number;memoryMiB?:number;slot?:string;first?:string;installerTray?:string;diskName?:string};
type Target={vmUid?:string;previousInstanceUid?:string|null;disks?:string[]};
type Observation={state:"converged"|"waiting"|"uncertain"|"not-applicable";reason:string;instanceUid?:string|null};
async function optional(path:string){
 try{return await kube("GET",path) as Resource}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
const observation=(state:Observation["state"],reason:string,instanceUid?:string|null):Observation=>({state,reason,...(instanceUid!==undefined?{instanceUid}:{})});
export function lifecycleObservation(action:string,vm:Resource|null,vmi:Resource|null,target:Target):Observation{
 if(!vm){
  if(action==="delete"&&target.vmUid)return observation("waiting","VM absent; verify managed storage cleanup");
  return observation("uncertain","Computer absent or ownership cannot be established");
 }
 if(target.vmUid&&target.vmUid!==vm.metadata?.uid)return observation("uncertain","Computer identity changed");
 const phase=(vmi?.status as {phase?:string}|undefined)?.phase;
 const uid=vmi?.metadata?.uid??null;
 if(action==="create")return observation("converged","Owned deterministic VM definition exists; guest boot not implied",uid);
 if(action==="start")return phase==="Running"?observation("converged","VMI Running; guest boot not implied",uid):observation("waiting","VMI has not reached Running",uid);
 if(action==="stop"){
  const s=vm.status as {stateChangeRequests?:unknown[];ready?:boolean;created?:boolean}|undefined;
  return !vmi&&!s?.ready&&!s?.created&&!s?.stateChangeRequests?.length?observation("converged","No VMI and no pending lifecycle change",null):observation("waiting","VM stop has not converged",uid);
 }
 if(action==="restart"){
  if(!target.previousInstanceUid)return observation("uncertain","Previous VMI identity was not recorded",uid);
  return phase==="Running"&&uid!==null&&uid!==target.previousInstanceUid?observation("converged","Different VMI reached Running; guest boot not implied",uid):observation("waiting","Replacement VMI has not converged",uid);
 }
 if(action==="delete")return observation("waiting","VM definition still exists",uid);
 return observation("not-applicable","No lifecycle observation for action");
}
async function inspect(row:Row):Promise<Observation>{
 const intent=row.intent as Intent|null,target=(row.target??{}) as Target;
 const id=intent?.computerId,action=intent?.action;
 if(!id||!/^vm-[a-f0-9]{32}$/.test(id)||!action)return observation("not-applicable","No safely reconcilable intent");
 if(row.status==="rejected")return observation("not-applicable","Submission rejected");
 if(row.status==="pending")return observation("waiting","Submission still active");
 if(!["create","start","stop","restart","delete","hardware","boot","media-upload","media-commit","disk-create","disk-clone","disk-import","disk-attach","disk-detach"].includes(action))return observation("not-applicable","Operation requires its feature-specific status endpoint");
 const vm=await optional(vmPath(id));
 if(vm&&vm.metadata?.labels?.["vm-interface.io/account"]!==row.account)return observation("uncertain","Computer ownership cannot be established");
 if(action!=="create"&&!target.vmUid&&!["media-upload","media-commit"].includes(action))return observation("uncertain","No pre-mutation target identity recorded");
 if(action==="delete"&&!vm){
  for(const disk of target.disks??[]){
   if(![id+"-boot",id+"-exchange",id+"-installer",id+"-auxiliary"].includes(disk)&&!(disk.startsWith(id+"-data-")&&/^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$/.test(disk.slice(id.length+6))))return observation("uncertain","Unrecognized cleanup target");
   if(await optional(dvPath(disk))||await optional(pvcPath(disk)))return observation("waiting","Managed storage cleanup pending");
  }
  return observation("converged","Owned VM target and recorded managed storage absent");
 }
 if(!vm||target.vmUid&&vm.metadata?.uid!==target.vmUid)return observation("uncertain","Computer identity unavailable or changed");
 if(["media-upload","media-commit"].includes(action)){
  if(!isMediaSlot(intent.slot))return observation("uncertain","Missing valid media slot");
  const m=await mediaStatus(id,row.account,intent.slot);
  return m?.ready?observation("converged","Declared input verified and CDI import succeeded"):observation("waiting","CDI media import not yet verified");
 }
 if(["disk-create","disk-clone","disk-import","disk-attach","disk-detach"].includes(action)){
  const s=await inspectStorage(id,row.account),disk=s.volumes.find(v=>v.kind==="data"&&v.diskName===intent.diskName);
  return disk?.dataVolumeUid&&disk.attached===(action==="disk-attach")&&(action!=="disk-clone"||(disk.dataVolumePhase==="Succeeded"&&disk.pvcPhase==="Bound"&&!!disk.pvcUid))?observation("converged","Owned data disk and requested attachment state observed; guest readiness not implied"):observation("waiting","Data disk or desired attachment state not yet confirmed");
 }
 const vmi=await optional(vmiPath(id));
 if(action==="boot")return bootPreference(vm)===intent.first&&(!intent.installerTray||installerTray(vm)===intent.installerTray)?observation("converged","Desired boot order and requested tray state observed; guest boot not implied",vmi?.metadata?.uid??null):observation("waiting","Desired boot order differs from request");
 if(action==="hardware"){
  const d=(vm.spec as {template?:{spec?:{domain?:{cpu?:{cores?:number};resources?:{requests?:{memory?:string}}}}}})?.template?.spec?.domain;
  return d?.cpu?.cores===intent.cpu&&d?.resources?.requests?.memory===intent.memoryMiB+"Mi"?observation("converged","Requested desired CPU and RAM present; effective state requires start",vmi?.metadata?.uid??null):observation("waiting","Desired hardware differs from request");
 }
 if(action==="create"){
  const s=await inspectStorage(id,row.account);
  if(s.volumes.some(v=>v.mode==="virtiofs"&&!v.pvcUid))return observation("waiting","Exchange PVC creation incomplete");
 }
 return lifecycleObservation(action,vm,vmi,target);
}
export async function observeOperation(row:Row){
 const old=row.observation as Observation|null;
 if(old?.state==="converged"||old?.state==="not-applicable"||row.observedAt&&Date.now()-row.observedAt.getTime()<2000)return row;
 let result:Observation;
 try{result=await inspect(row)}catch{result=observation("uncertain","Observation unavailable; retry without repeating mutation")}
 const now=new Date();
 const [updated]=await database().update(operations).set({observation:result,observedAt:now}).where(and(eq(operations.account,row.account),eq(operations.id,row.id),eq(operations.status,row.status))).returning();
 return updated??row;
}
