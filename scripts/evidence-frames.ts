/** Independently decode and OCR reported original MP4 frames. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cirrosNormalize } from "./cirros-screen.ts";
export const normalized=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]/g,"");
export function frameNumber(name:string){const m=/^frame-([0-9]{5})\.png$/.exec(name),n=Number(m?.[1]);if(!m||n<1||n>240)throw Error("Invalid frame reference");return n-1;}
export function pixels(path:string){return execFileSync("ffmpeg",["-v","error","-i",path,"-frames:v","1","-vf","scale=1280:720","-f","rawvideo","-pix_fmt","rgb24","-"],{timeout:30000,maxBuffer:4*1024**2});}
export function decodedFrame(raw:string,index:number,dest:string){
 execFileSync("ffmpeg",["-v","error","-i",raw,"-vf","fps=2,select=eq(n\\,"+index+")","-fps_mode","passthrough","-frames:v","1","-c:v","png",dest],{timeout:60000});
 if(!existsSync(dest))throw Error("Referenced video frame does not exist");
}
export function ocrText(path:string){return execFileSync("tesseract",[path,"stdout","--psm","6","--dpi","180"],{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","ignore"],env:{...process.env,OMP_THREAD_LIMIT:"1",OMP_NUM_THREADS:"1"}});}
export function ocr(path:string,cirros=false){const text=ocrText(path);return cirros?cirrosNormalize(text):normalized(text);}
export type FrameMeta={firstFrame:string;finalFrame:string;markers:{before:string;after:string}};
export function verifyMarkerFrames(raw:string,folder:string,meta:FrameMeta,profile:string){
 const first=frameNumber(meta.firstFrame),last=frameNumber(meta.finalFrame);
 if(first>=last)throw Error("Reported markers are not in chronological order");
 const {before,after}=meta.markers;
 if([before,after].some(x=>typeof x!=="string"||normalized(x)!==x||x.length<1||x.length>100)||before===after)throw Error("Invalid marker declaration");
 if(profile==="control"&&(before!=="scriptstart"||after!=="scriptdone"))throw Error("Incorrect control markers");
 if(profile==="functional"&&(before!=="proofready"||after!=="proofcomplete"))throw Error("Incorrect functional markers");
 if(profile==="android"&&!after.includes("apkcompletearm64v8a"))throw Error("Missing Android ARM64 marker");
 if(profile==="windows"&&!["7zip","proof7z"].some(x=>after.includes(x)))throw Error("Missing Windows application marker");
 const temp=mkdtempSync(join(tmpdir(),"vm-frames-"));
 try{
  for(const [index,name,expected] of [[first,"video-first-marker.png",before],[last,"video-final-marker.png",after]] as const){
   const path=join(temp,name);decodedFrame(raw,index,path);
   if(!pixels(path).equals(pixels(join(folder,name))))throw Error("Marker frame does not match original video");
   const text=ocr(path,profile==="control");
   if(text.split(expected).length!==2||(index===first&&text.includes(after)))throw Error("Required unique marker absent or out of order");
  }
 }finally{rmSync(temp,{recursive:true,force:true});}
 return {independentlyDecodedMarkerFrames:true,before,after};
}
