import {createHash,randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {open,link,unlink,opendir} from "node:fs/promises";
import {join} from "node:path";
import {ApiError} from "./kube";
import {exchangeFileName,MAX_FILE_BYTES} from "./exchange";
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
export async function readBounded(root:string,name:string,max=MAX_FILE_BYTES){
 let fd;
 try{fd=await open(join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)}
 catch(e){if(["ENOENT","ELOOP","ENOTDIR"].includes((e as NodeJS.ErrnoException).code??""))throw new ApiError(404,"File unavailable");throw e}
 try{
  const before=await fd.stat();
  if(!before.isFile()||before.nlink!==1||before.size>max)throw new ApiError(422,"Unsupported exchange file");
  const out=Buffer.alloc(before.size);
  let pos=0;
  while(pos<out.length){const r=await fd.read(out,pos,out.length-pos,pos);if(!r.bytesRead)throw new ApiError(409,"File changed during read");pos+=r.bytesRead}
  const after=await fd.stat();
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new ApiError(409,"File changed during read");
  return out;
 }finally{await fd.close()}
}
export async function publish(root:string,name:string,data:Buffer,digest:string){
 exchangeFileName(name);
 if(data.length>MAX_FILE_BYTES)throw new ApiError(413,"File too large");
 if(hash(data)!==digest)throw new ApiError(422,"Checksum mismatch");
 const final="in-"+name,tmp=".stage-"+randomUUID();
 try{
  const fd=await open(join(root,tmp),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o660);
  try{await fd.writeFile(data);await fd.sync()}finally{await fd.close()}
  try{await link(join(root,tmp),join(root,final))}catch(e){
   if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
   const existing=await readBounded(root,final);
   if(hash(existing)!==digest)throw new ApiError(409,"Existing file differs");
  }
 }finally{await unlink(join(root,tmp)).catch(()=>{})}
 return {name,size:data.length,sha256:digest,direction:"upload",guestReference:"exchange/"+final};
}
export async function download(root:string,name:string){
 exchangeFileName(name);
 const marker="out-"+name+".sha256", file="out-"+name;
 const expected=(await readBounded(root,marker,128)).toString("ascii").trim();
 if(!/^[0-9a-f]{64}$/.test(expected))throw new ApiError(409,"Guest publication checksum missing");
 const bytes=await readBounded(root,file);
 const sha256=hash(bytes);
 if(sha256!==expected||(await readBounded(root,marker,128)).toString("ascii").trim()!==expected)throw new ApiError(409,"Guest output incomplete or changed");
 return {bytes,sha256};
}
export async function listFiles(root:string){
 const dir=await opendir(root),names:string[]=[];let entries=0;
 for await(const entry of dir){if(++entries>512)throw new ApiError(409,"Exchange directory entry limit exceeded");if(entry.name.startsWith("out-")&&entry.name.endsWith(".sha256"))names.push(entry.name)}
 const files=[];let total=0;
 for(const n of names){
  const name=n.slice(4,-7);
  try{const d=await download(root,name);total+=d.bytes.length;if(total>64*1024*1024)break;files.push({name,size:d.bytes.length,sha256:d.sha256,direction:"download"})}
  catch(e){if(!(e instanceof ApiError))throw e}
  if(files.length>=64)break;
 }
 return files;
}
