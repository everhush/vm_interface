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

const MAX_BUNDLE_BYTES=32*1024*1024;
const MAX_BUNDLE_FILES=64;
// USTAR with fixed safe names, numeric fields and deterministic metadata.
// Never invoke tar on a guest-controlled directory or follow links.
function tarHeader(name:string,size:number){
 const h=Buffer.alloc(512);
 const field=(value:string,offset:number,width:number)=>{if(Buffer.byteLength(value,"ascii")>width)throw new ApiError(409,"Bundle header overflow");h.write(value,offset,width,"ascii")};
 const octal=(n:number,width:number)=>n.toString(8).padStart(width-1,"0")+"\0";
 const slash=name.indexOf("/");
 if(slash>=0){field(name.slice(slash+1),0,100);field(name.slice(0,slash),345,155)}else field(name,0,100);
 field(octal(0o600,8),100,8);field(octal(0,8),108,8);field(octal(0,8),116,8);
 field(octal(size,12),124,12);field(octal(0,12),136,12);h.fill(32,148,156);field("0",156,1);
 field("ustar\0",257,6);field("00",263,2);
 field(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,"0")+"\0 ",148,8);
 return h;
}
export async function exchangeBundle(root:string){
 const dir=await opendir(root),names=new Set<string>();let entries=0;
 for await(const entry of dir){
  if(++entries>512)throw new ApiError(409,"Exchange directory entry limit exceeded");
  if(entry.name.startsWith("in-")||entry.name.startsWith("out-"))names.add(entry.name);
 }
 const records:{name:string;bytes:number;sha256:string;direction:"upload"|"download"}[]=[],parts:Buffer[]=[];
 let total=1024;
 function append(name:string,data:Buffer){
  const pad=(512-data.length%512)%512;total+=512+data.length+pad;
  if(total>MAX_BUNDLE_BYTES)throw new ApiError(413,"Published exchange bundle exceeds 32 MiB; download individual files");
  parts.push(tarHeader(name,data.length),data);if(pad)parts.push(Buffer.alloc(pad));
 }
 for(const entry of [...names].sort()){
  const incoming=entry.startsWith("in-");
  if(!incoming&&entry.endsWith(".sha256")){
   if(!names.has(entry.slice(0,-7)))throw new ApiError(409,"Guest publication incomplete");
   continue;
  }
  if(records.length>=MAX_BUNDLE_FILES)throw new ApiError(413,"Published exchange bundle exceeds file count limit");
  const name=exchangeFileName(entry.slice(incoming?3:4));
  if(!incoming&&!names.has(entry+".sha256"))throw new ApiError(409,"Guest publication incomplete");
  const data=incoming?await readBounded(root,entry):(await download(root,name)).bytes;
  const direction=incoming?"upload":"download",path=direction+"/"+name;
  append(path,data);records.push({name:path,bytes:data.length,sha256:hash(data),direction});
 }
 append("manifest.json",Buffer.from(JSON.stringify({version:1,scope:"published-exchange-files-only",files:records},null,2)+"\n"));
 parts.push(Buffer.alloc(1024));
 const bytes=Buffer.concat(parts,total);
 return {bytes,sha256:hash(bytes)};
}
