/** Real product API recording tools shared by native proofs. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readdirSync,rmSync,readFileSync,writeFileSync,copyFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,basename} from "node:path";
import {client,key,sha,sleep,wait} from "./api-client.ts";
import {ocr,ocrText} from "./evidence-frames.ts";
export const batch=(text:string)=>({events:[...text].flatMap(ch=>[true,false].map(down=>({type:"key",keysym:ch.codePointAt(0)!,down})))});
export const count=(text:string,marker:string)=>text.split(marker).length-1;
export const png=Buffer.from([137,80,78,71,13,10,26,10]);
export function ffmpeg(args:string[],timeout=90000){execFileSync("ffmpeg",args,{timeout,stdio:"inherit"});}
export function proofTools(out:string){
 const api=client({out,automaticKeys:true}),{call,binary,events}=api;
 const file=(name:string)=>join(out,name);
 async function screen(path:string,name:string,cirros=false){
  const [data,headers]=await binary("GET",path+"/screenshot");assert.equal(headers.get("content-type"),"image/png");assert(data.subarray(0,8).equals(png));writeFileSync(file(name),data);
  const text=ocrText(file(name));return [ocr(file(name),cirros),text.toLowerCase()] as const;
 }
 async function coldResize(path:string,cpu:number,memoryMiB:number){
  const halted=async()=>{const v=await call("GET",path),s=v.status??{};return !v.instance&&v.desired.runStrategy==="Halted"&&!s.stateChangeRequests?.length&&!s.created&&!s.ready?v:null;};
  const initial=(await wait(halted,120,"VM did not converge to halted")).desired,deadline=performance.now()+45000;
  while(performance.now()<deadline){
   const v=await halted();assert(v);assert.deepEqual(v.desired,initial);
   const body={cpu,memoryMiB,expectedResourceVersion:v.resourceVersion},idem=key();
   const result=await call("PATCH",path+"/hardware",{body,idem,expected:[202,409],phase:"cold resize"});
   if(result.error){assert(["Configuration version changed; inspect current VM","Kubernetes rejected request (409)"].includes(result.error));assert.deepEqual(await call("PATCH",path+"/hardware",{body,idem,expected:409}),result);await sleep(1);continue;}
   assert.equal(result.status,"submitted");assert.deepEqual(await call("PATCH",path+"/hardware",{body,idem,expected:202}),result);return result;
  }
  throw Error("Cold resize optimistic concurrency did not stabilize");
 }
 function checkVideo(raw:string,first:string,second:string){
  ffmpeg(["-v","error","-xerror","-i",raw,"-f","null","-"]);
  const p=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",raw],{timeout:30000,encoding:"utf8"}));
  assert(p.streams.length===1&&p.streams[0].codec_name==="h264"&&Number(p.format.duration)>0);
  const tmp=mkdtempSync(join(tmpdir(),"vm-proof-"));let firstFrame:string|undefined,finalFrame:string|undefined;
  try{
   ffmpeg(["-v","error","-i",raw,"-vf","fps=2",join(tmp,"frame-%05d.png")]);
   const frames=readdirSync(tmp).filter(x=>/^frame-\d{5}\.png$/.test(x)).sort();assert(frames.length>=4);
   for(const frame of frames){const text=ocr(join(tmp,frame),first==="scriptstart");
    if(!firstFrame&&count(text,first)===1&&!text.includes(second)){firstFrame=frame;copyFileSync(join(tmp,frame),file("video-first-marker.png"));}
    if(firstFrame&&text.includes(second)){assert.equal(count(text,second),1);finalFrame=frame;copyFileSync(join(tmp,frame),file("video-final-marker.png"));break;}
   }
   assert(firstFrame&&finalFrame,"Video did not show ordered real guest actions");
   return {firstFrame,finalFrame,codec:"h264",markers:{before:first,after:second},durationSeconds:Number(p.format.duration),fullDecode:true};
  }finally{rmSync(tmp,{recursive:true,force:true});}
 }
 function presentation(raw:string,title="REAL API CONTROL PROOF"){
  const phases=new Set(["create","start","controller key","control ticket","record start","lease acquire","first input","second input","idempotent replay","lease release","record stop","retrieve MP4","stop","delete","upload file","download file","guest action"]);
  let lines=[title,"Actual API-retrieved guest video (left)","Observed script HTTP calls (below)","Trace is not frame-synchronized",""];
  for(const e of events)if(e.status===e.expected&&e.phase&&phases.has(e.phase))lines.push((e.elapsedMs/1000).toFixed(1).padStart(7)+"s  "+e.method.padEnd(6)+" "+e.status+"  "+e.phase);
  if(lines.length>27)lines=[...lines.slice(0,24),"... full trace in companion JSONL",...lines.slice(-2)];
  lines.push("","Full HTTP trace and SHA256: companion files","No credentials recorded");
  const panel=file("presentation-trace.txt"),output=file("api-control-presentation.mp4");
  writeFileSync(panel,lines.join("\n")+"\n");
  assert(!/[':\\]/.test(panel),"Invalid presentation output path");
  ffmpeg(["-v","error","-y","-i",raw,"-vf","scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:720:0:0:color=0x15202b,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:textfile="+panel+":x=1300:y=35:fontsize=16:fontcolor=white:line_spacing=4","-an","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",output],120000);
  ffmpeg(["-v","error","-xerror","-i",output,"-f","null","-"]);
  return {file:basename(output),sha256:sha(readFileSync(output)),derivedFrom:basename(raw),tracePanel:basename(panel),frameSynchronized:false};
 }
 return {...api,file,screen,coldResize,checkVideo,presentation};
}
