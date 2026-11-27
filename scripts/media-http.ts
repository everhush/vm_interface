/** Bounded binary HTTP client. No redirects, retry or synthetic status; credentials only via curl stdin. */
import {spawn} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
export const MAX_BYTES=64*1024**2;
export function quote(value:string){if(/[\x00-\x1f\x7f]/.test(value))throw Error("Invalid HTTP configuration value");return '"'+value.replaceAll("\\","\\\\").replaceAll('"','\\"')+'"';}
export async function binaryRequest(url:string,method:string,headers:Record<string,string>,body:Buffer){
 const u=new URL(url);if(!["http:","https:"].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash)throw Error("Expected explicit HTTP(S) endpoint");
 if(method!=="PUT"||body.length<1||body.length>MAX_BYTES)throw Error("Expected bounded media PUT");
 const folder=mkdtempSync(join(tmpdir(),"vm-media-client-")),path=join(folder,"body");
 try{
  writeFileSync(path,body,{mode:0o600});
  const config=["silent","show-error","http1.1","noproxy = "+quote("*"),"proto = "+quote("=http,https"),"url = "+quote(url),"request = "+quote(method),"connect-timeout = 10","max-time = 240","expect100-timeout = 1","max-filesize = 1048576","data-binary = "+quote("@"+path),"header = "+quote("Expect: 100-continue"),...Object.entries(headers).map(([k,v])=>"header = "+quote(k+": "+v)),'write-out = "\\n%{http_code}"'];
  const data=await new Promise<Buffer>((resolve,reject)=>{
   const child=spawn("curl",["--disable","--config","-"],{stdio:["pipe","pipe","ignore"],timeout:250000});
   const parts:Buffer[]=[];let length=0;
   child.stdout.on("data",(chunk:Buffer)=>{length+=chunk.length;if(length>1048580){child.kill();reject(Error("Media HTTP response exceeded bound"));}else parts.push(chunk);});
   child.on("error",reject);child.stdin.on("error",reject);
   child.on("close",code=>code===0?resolve(Buffer.concat(parts)):reject(Error("Media HTTP transport failed (curl exit "+code+"); inspect operation state, do not blindly retry")));
   child.stdin.end(config.join("\n")+"\n");
  });
  const sep=data.lastIndexOf(10),statusText=data.subarray(sep+1).toString("ascii"),status=Number(statusText);
  if(sep<0||!/^[0-9]{3}$/.test(statusText)||status<100||status>599)throw Error("Missing actual HTTP response");
  return [status,data.subarray(0,sep)] as const;
 }finally{rmSync(folder,{recursive:true,force:true});}
}
