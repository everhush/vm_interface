import {and,eq,lt,sql} from "drizzle-orm";
import {database,vmActivity} from "./db";
import {ApiError,owned,kube,actionPath,vmiPath,type Resource} from "./kube";
import {withVmLock} from "./hardware";
import {mutate,recordOperationTarget} from "./operation";
import {recordAudit} from "./audit";
export function idleSeconds(vm:Resource){
 const value=vm.metadata?.annotations?.["vm-interface.io/idle-stop-seconds"];
 if(value===undefined)return null;
 if(!/^\d{2,5}$/.test(value)||Number(value)<60||Number(value)>86400)throw new ApiError(409,"Invalid stored idle policy");
 return Number(value);
}
export function shouldIdleStop(last:number,seconds:number,now:number,protectedSession:boolean){
 return Number.isFinite(last)&&Number.isFinite(now)&&seconds>=60&&seconds<=86400&&now-last>=seconds*1000&&!protectedSession;
}
async function optionalVm(id:string,account:string){
 try{return await owned(id,account)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
/** Record authorized API activity only for opted-in VMs. Active tickets protect
 * actual RFB input without storing keystrokes or polling guest traffic. */
export async function touchIdleActivity(id:string,account:string){
 const vm=await optionalVm(id,account);
 if(!vm||idleSeconds(vm)===null||!vm.metadata?.uid)return;
 await withVmLock(id,async()=>{
  const current=await owned(id,account);
  if(current.metadata?.uid!==vm.metadata?.uid)throw new ApiError(409,"VM identity changed");
  const now=new Date();
  const values={computerId:id,account,vmUid:vm.metadata!.uid!,lastActivity:now};
  await database().insert(vmActivity).values(values).onConflictDoUpdate({target:vmActivity.computerId,set:{lastActivity:now}});
 });
}
async function protectedActivity(id:string,account:string){
 const rows=await database().execute(sql`SELECT (
 EXISTS(SELECT 1 FROM console_tickets WHERE account=${account} AND computer_id=${id} AND revoked_at IS NULL AND expires_at>now())
 OR EXISTS(SELECT 1 FROM input_leases WHERE account=${account} AND computer_id=${id} AND expires_at>now())
 OR EXISTS(SELECT 1 FROM recordings WHERE account=${account} AND computer_id=${id} AND status IN ('queued','recording','stopping'))
 OR EXISTS(SELECT 1 FROM network_grants WHERE account=${account} AND computer_id=${id} AND revoked_at IS NULL AND expires_at>now())
 OR EXISTS(SELECT 1 FROM operations WHERE account=${account} AND intent->>'computerId'=${id} AND
   (status='pending' OR (status IN ('submitted','unknown') AND intent->>'action' IN ('create','start','stop','restart','delete','hardware','boot','media-upload','media-commit') AND COALESCE(observation->>'state','') NOT IN ('converged','not-applicable'))))
 ) AS busy`);
 return rows[0]?.busy!==false;
}
export async function reconcileIdle(){
 const rows=await database().select().from(vmActivity).where(lt(vmActivity.lastActivity,new Date(Date.now()-5000))).orderBy(vmActivity.lastActivity).limit(16);
 for(const row of rows){
  try{await withVmLock(row.computerId,async()=>{
   const id=row.computerId,account=row.account,vm=await optionalVm(id,account);
   const seconds=vm&&idleSeconds(vm);
   if(!vm||seconds===null||vm.metadata?.uid!==row.vmUid){
    await database().delete(vmActivity).where(and(eq(vmActivity.computerId,id),eq(vmActivity.vmUid,row.vmUid)));return;
   }
   if(!seconds)return;
   const [activity]=await database().select().from(vmActivity).where(eq(vmActivity.computerId,id));
   if(!activity)return;
   let vmi:Resource;try{vmi=await kube("GET",vmiPath(id)) as Resource}catch(e){if(e instanceof ApiError&&e.status===404){await database().update(vmActivity).set({instanceUid:null,lastActivity:new Date()}).where(eq(vmActivity.computerId,id));return}throw e}
   const uid=vmi.metadata?.uid;
   const status=vm.status as {stateChangeRequests?:unknown[];ready?:boolean}|undefined;
   if(!uid||vmi.metadata?.deletionTimestamp||(vmi.status as {phase?:string})?.phase!=="Running"||!status?.ready||status.stateChangeRequests?.length)return;
   if(activity.instanceUid!==uid){
    await database().update(vmActivity).set({instanceUid:uid,lastActivity:new Date()}).where(eq(vmActivity.computerId,id));return;
   }
   if(!shouldIdleStop(activity.lastActivity.getTime(),seconds,Date.now(),await protectedActivity(id,account)))return;
   // One automatic stop submission per VMI. Never replay a lost/destructive
   // action or stop an unowned/replaced instance.
   await mutate(account,"idle-stop:"+uid,{action:"stop",id},async op=>{
    await recordOperationTarget(account,op,{vmUid:row.vmUid,previousInstanceUid:uid});
    await kube("PUT",actionPath(id,"stop"),{});
    return {id,reason:"idle-policy"};
   });
   await recordAudit({account,actor:"system",method:"POST",group:"stop",computerId:id},202);
   await database().update(vmActivity).set({lastActivity:new Date()}).where(eq(vmActivity.computerId,id));
  })}catch{/* fail safe: never stop if ownership, activity or locks cannot be verified */}
 }
}
