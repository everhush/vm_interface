import {and,inArray,or,lt,isNull,sql} from "drizzle-orm";
import {database,operations} from "./db";
import {normalizePending,PENDING_TIMEOUT_MS} from "./operation";
import {observeOperation} from "./reconcile-operation";
import {opendir,lstat,unlink} from "node:fs/promises";
import {join} from "node:path";
import {reapMediaStages} from "./media-resume";
import {reconcileIdle} from "./idle";
import {reapAudit} from "./audit";
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function reconcile(){
 const now=Date.now();
 const rows=await database().select().from(operations).where(and(
  or(inArray(operations.status,["submitted","unknown"]),and(inArray(operations.status,["pending"]),lt(operations.updatedAt,new Date(now-PENDING_TIMEOUT_MS)))),
  or(isNull(operations.observedAt),lt(operations.observedAt,new Date(now-10000))),
  sql`COALESCE(${operations.observation}->>'state','') NOT IN ('converged','not-applicable')`
 )).orderBy(sql`${operations.observedAt} ASC NULLS FIRST`).limit(12);
 for(const row of rows){
  try{await observeOperation(await normalizePending(row))}catch{/* retry a later pass */}
 }
}
async function reapStage(){
 // Direct media requests are bounded; only stale generated
 // temporary files can be removed. Never inspect or remove guest files.
 const root="/var/lib/vm-media-stage";
 try{
  const dir=await opendir(root);let scanned=0;
  for await(const entry of dir){
   if(++scanned>256)break;
   if(!/^[0-9a-f-]{36}\.part$/.test(entry.name))continue;
   const path=join(root,entry.name),s=await lstat(path).catch(()=>null);
   if(s?.isFile()&&Date.now()-s.mtimeMs>15*60*1000)await unlink(path).catch(()=>{});
  }
 }catch{/* volume may be unavailable; retry */}
}
for(;;){
 try{await reconcile();await reapStage();await reapMediaStages();await reconcileIdle();await reapAudit()}catch{/* migrations/cluster may not be ready */}
 await delay(5000);
}
