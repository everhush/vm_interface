/** Exact OCR boot marker on original and scaled/inverted source pixels. */
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
export const MARKER="ISOBOOTPROOFPASSED";
export function parsePgm(raw:Buffer,maxWidth=1920,maxHeight=1200){
 const a=raw.indexOf(10),b=raw.indexOf(10,a+1),c=raw.indexOf(10,b+1);
 assert(a===2&&b>a&&c>b&&raw.subarray(0,a).toString()==="P5"&&raw.subarray(b+1,c).toString()==="255","Invalid guest raster");
 const dims=/^(\d+) (\d+)$/.exec(raw.subarray(a+1,b).toString());assert(dims,"Invalid guest raster dimensions");
 const w=Number(dims[1]),h=Number(dims[2]),pixels=raw.subarray(c+1);
 assert(w>0&&w<=maxWidth&&h>0&&h<=maxHeight&&pixels.length===w*h,"Invalid or oversized guest raster");
 return [w,h,pixels] as const;
}
export function cropForOcr(w:number,h:number,pixels:Buffer){
 const dark=pixels.reduce((a,b)=>a+b,0)<pixels.length*128;let x0=w,y0=h,x1=0,y1=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=pixels[y*w+x];if(dark?v>30:v<225){x0=Math.min(x0,x);x1=Math.max(x1,x+1);y0=Math.min(y0,y);y1=Math.max(y1,y+1);}}
 if(x0>=x1||y0>=y1)return null;
 const factor=5,width=(x1-x0)*factor+40,height=(y1-y0)*factor+40,data=Buffer.alloc(width*height,255);
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)for(let dy=0;dy<factor;dy++){const v=pixels[y*w+x],start=(20+(y-y0)*factor+dy)*width+20+(x-x0)*factor;data.fill(dark?255-v:v,start,start+factor);}
 return Buffer.concat([Buffer.from("P5\n"+width+" "+height+"\n255\n"),data]);
}
export const exactMarker=(text:string)=>text.toUpperCase().replace(/[^A-Z]/g,"").includes(MARKER);
export function readMarker(png:string){
 const env={...process.env,OMP_THREAD_LIMIT:"1",OMP_NUM_THREADS:"1"};
 let original=execFileSync("tesseract",[png,"stdout","--psm","6"],{encoding:"utf8",timeout:30000,env});
 if(exactMarker(original))return [true,original] as const;
 const pgm=execFileSync("ffmpeg",["-v","error","-i",png,"-frames:v","1","-f","image2pipe","-vcodec","pgm","-"],{timeout:15000,maxBuffer:3*1024**2});
 const scaled=cropForOcr(...parsePgm(pgm));
 if(scaled)for(const psm of ["6","11"]){const text=execFileSync("tesseract",["stdin","stdout","--psm",psm,"--dpi","180"],{input:scaled,encoding:"utf8",timeout:30000,env});if(exactMarker(text))return [true,text] as const;original=text;}
 return [false,original] as const;
}
