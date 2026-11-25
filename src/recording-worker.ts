import {randomUUID,createHash} from "node:crypto";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile,stat,link,unlink} from "node:fs/promises";
import {and,eq,inArray,lt} from "drizzle-orm";
import {database,recordings} from "./db";
import {recordingFence,recordingPath,RECORDING_MAX_BYTES} from "./recordings";
import {screenshot} from "./screenshot";

const exec=promisify(execFile),workerId=randomUUID();
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const FPS=2,STALE_MS=90000;
type Recording=typeof recordings.$inferSelect;
function timeout<T>(p:Promise<T>,ms:number,onTimeout:()=>void){
 return new Promise<T>((resolve,reject)=>{
  const timer=setTimeout(()=>{onTimeout();reject(Error("Recording stage timed out"))},ms);
  p.then(v=>{clearTimeout(timer);resolve(v)},e=>{clearTimeout(timer);reject(e)});
 });
}
async function reap(){
 // Failed worker output is never published as a completed artifact.
 const stale=await database().update(recordings).set({status:"failed",finishedAt:new Date(),error:"Capture worker heartbeat expired"}).where(and(inArray(recordings.status,["recording","stopping"]),lt(recordings.heartbeatAt,new Date(Date.now()-STALE_MS)))).returning({id:recordings.id,workerId:recordings.workerId});
 for(const r of stale){
  if(r.workerId&&/^[0-9a-f-]{36}$/.test(r.workerId)){
   try{await unlink(recordingPath(r.id)+"."+r.workerId+".partial.mp4")}catch{/* worker may have removed it */}
  }
 }
}
async function claim(){
 return database().transaction(async tx=>{
  const [queued]=await tx.select().from(recordings).where(eq(recordings.status,"queued")).orderBy(recordings.createdAt).limit(1).for("update",{skipLocked:true});
  if(!queued)return null;
  const now=new Date();
  const [r]=await tx.update(recordings).set({status:"recording",workerId,startedAt:now,heartbeatAt:now}).where(and(eq(recordings.id,queued.id),eq(recordings.status,"queued"))).returning();
  return r??null;
 });
}
async function heartbeat(id:string){
 const [r]=await database().update(recordings).set({heartbeatAt:new Date()}).where(recordingFence(id,workerId)).returning();
 if(!r)throw Error("Capture worker fence lost");
 return r;
}
export function validateVideoProbe(value:unknown,size:number){
 const p=value as {format?:{duration?:string;size?:string};streams?:{codec_type?:string;codec_name?:string}[]};
 const duration=Number(p?.format?.duration);
 if(!Number.isFinite(duration)||duration<=0||duration>125||!Number.isSafeInteger(size)||size<=0||size>RECORDING_MAX_BYTES||Number(p?.format?.size)!==size||p.streams?.length!==1||p.streams[0].codec_type!=="video"||p.streams[0].codec_name!=="h264")throw Error("Invalid completed MP4");
 return Math.round(duration*1000);
}
async function capture(r:Recording){
 const final=recordingPath(r.id),tmp=final+"."+workerId+".partial.mp4";
 const child=spawn("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-f","image2pipe","-framerate",String(FPS),"-vcodec","png","-i","pipe:0","-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p","-an","-c:v","libx264","-preset","ultrafast","-movflags","+faststart","-fs",String(RECORDING_MAX_BYTES),"-n",tmp],{stdio:["pipe","ignore","pipe"]});
 child.stderr.resume();child.stdin.on("error",()=>{});
 const done=new Promise<void>((resolve,reject)=>{
  child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error("Video encoder failed")));
 });void done.catch(()=>{});
 const started=Date.now(),deadline=started+r.maxSeconds*1000;let frames=0;
 try{
  while(Date.now()<deadline&&frames<r.maxSeconds*FPS){
   const current=await heartbeat(r.id);
   if(current.stopRequestedAt)break;
   const png=await screenshot(r.computerId,r.account,r.instanceUid);
   if(Date.now()>deadline&&frames>=2)break;
   // Recheck the worker fence after upstream capture before forwarding bytes.
   const after=await heartbeat(r.id);
   if(after.stopRequestedAt&&frames>=2)break;
   await timeout(new Promise<void>((resolve,reject)=>child.stdin.write(png,e=>e?reject(e):resolve())),15000,()=>child.kill("SIGKILL"));
   frames++;
   await sleep(Math.max(0,started+frames*1000/FPS-Date.now()));
  }
  if(frames<2)throw Error("Capture ended before two real frames");
  child.stdin.end();
  await timeout(done,30000,()=>child.kill("SIGKILL"));
  const meta=await stat(tmp);
  if(!meta.isFile()||meta.size>RECORDING_MAX_BYTES)throw Error("Invalid recording size");
  const probe=await exec("ffprobe",["-v","error","-show_streams","-show_format","-of","json",tmp],{timeout:15000,maxBuffer:256*1024});
  const durationMs=validateVideoProbe(JSON.parse(probe.stdout),meta.size);
  // Verify the entire bounded video decodes before publishing.
  await exec("ffmpeg",["-v","error","-xerror","-i",tmp,"-f","null","-"],{timeout:30000,maxBuffer:256*1024});
  const sha256=createHash("sha256").update(await readFile(tmp)).digest("hex");
  await database().transaction(async tx=>{
   const [current]=await tx.select().from(recordings).where(recordingFence(r.id,workerId)).for("update");
   if(!current)throw Error("Capture worker fence lost");
   await link(tmp,final); // atomic no-overwrite publication on the same PVC
   await tx.update(recordings).set({status:"completed",finishedAt:new Date(),durationMs,bytes:meta.size,sha256,error:null}).where(recordingFence(r.id,workerId));
  });
 }catch{
  child.kill("SIGKILL");
  await database().update(recordings).set({status:"failed",finishedAt:new Date(),error:"Capture, encoding or artifact verification failed"}).where(recordingFence(r.id,workerId));
 }finally{
  child.stdin.destroy();
  try{await unlink(tmp)}catch{/* no partial file or already removed */}
 }
}
export async function runRecordingWorker(){
 process.umask(0o077);
 for(;;){
  try{
   await reap();const row=await claim();
   if(row){await capture(row);continue}
  }catch{/* DB may be starting; do not log credentials or guest content */}
  await sleep(1000);
 }
}
