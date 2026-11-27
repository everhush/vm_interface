/** Package explicitly authorized Windows driver MSIs without executing them on host. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {openSync,closeSync,readSync,writeSync,lstatSync,mkdirSync,mkdtempSync,rmSync,copyFileSync,writeFileSync,linkSync,statSync} from "node:fs";
import {dirname,basename,join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {parseArgs} from "node:util";
import {fileSha256,isMain} from "../../scripts/tooling.ts";
export const MAX_MSI=256*1024**2,MSI_MAGIC=Buffer.from("d0cf11e0a1b11ae1","hex");
const ROOT=fileURLToPath(new URL(".",import.meta.url));
export function stagePackage(source:string,dest:string,sha256:string,thumbprint:string){
 assert(/^[a-f0-9]{64}$/.test(sha256),"Expected lowercase SHA256");
 assert(/^[A-Fa-f0-9]{40}$/.test(thumbprint),"Expected signer certificate thumbprint");
 assert(lstatSync(source).isFile(),"Expected regular authorized MSI");
 const inp=openSync(source,"r");let total=0;const hash=createHash("sha256"),buf=Buffer.alloc(1024**2);
 try{
  assert(readSync(inp,buf,0,8,0)===8&&buf.subarray(0,8).equals(MSI_MAGIC),"Expected MSI compound-file header");
  const out=openSync(dest,"wx",0o600);
  try{for(;;){const n=readSync(inp,buf,0,buf.length,total);if(!n)break;total+=n;assert(total<=MAX_MSI,"MSI exceeds bounded size");const b=buf.subarray(0,n);hash.update(b);let offset=0;while(offset<n){offset+=writeSync(out,b,offset,n-offset);}}}finally{closeSync(out);}
 }finally{closeSync(inp);}
 assert(hash.digest("hex")===sha256,"MSI SHA256 mismatch");
 return {name:basename(dest),bytes:total,sha256,signerThumbprint:thumbprint.toUpperCase()};
}
export function requireNewOutput(path:string){try{lstatSync(path);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return;throw e;}throw Error("Refusing output overwrite");}
type BuildArgs={output:string;winfsp:string;winfspSha:string;winfspSigner:string;virtio:string;virtioSha:string;virtioSigner:string};
export function build(args:BuildArgs){
 requireNewOutput(args.output);mkdirSync(dirname(args.output),{recursive:true});const temp=mkdtempSync(join(dirname(args.output),".drivers-"));
 try{const root=join(temp,"media");mkdirSync(root);
  const packages=[stagePackage(args.winfsp,join(root,"winfsp.msi"),args.winfspSha,args.winfspSigner),stagePackage(args.virtio,join(root,"virtio.msi"),args.virtioSha,args.virtioSigner)];
  copyFileSync(join(ROOT,"bootstrap.ps1"),join(root,"bootstrap.ps1"));writeFileSync(join(root,"packages.json"),JSON.stringify(packages,null,2)+"\n");
  const iso=join(temp,"drivers.iso");execFileSync("xorriso",["-as","mkisofs","-quiet","-R","-J","-V","VMDRIVERS","-o",iso,root],{timeout:180000});
  const sha256=fileSha256(iso),bytes=statSync(iso).size;linkSync(iso,args.output);
  return {bytes,sha256,packages,sizeGiB:Math.max(1,Math.ceil((bytes+64*1024**2)/966367640)),guestSignatureAndMountVerified:false};
 }finally{rmSync(temp,{recursive:true,force:true});}
}
if(isMain(import.meta.url)){
 const {values:v}=parseArgs({options:{output:{type:"string"},winfsp:{type:"string"},"winfsp-sha256":{type:"string"},"winfsp-signer":{type:"string"},virtio:{type:"string"},"virtio-sha256":{type:"string"},"virtio-signer":{type:"string"},authorized:{type:"boolean"}}});
 assert(v.authorized&&v.output&&v.winfsp&&v["winfsp-sha256"]&&v["winfsp-signer"]&&v.virtio&&v["virtio-sha256"]&&v["virtio-signer"],"Explicit authorized MSI inputs required");
 console.log(JSON.stringify(build({output:v.output,winfsp:v.winfsp,winfspSha:v["winfsp-sha256"],winfspSigner:v["winfsp-signer"],virtio:v.virtio,virtioSha:v["virtio-sha256"],virtioSigner:v["virtio-signer"]}),null,2));
}
