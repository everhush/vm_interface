/** Repackage only exact driver bytes from independently verified pinned ISO. */
import assert from "node:assert/strict";
import {readFileSync,lstatSync,statSync,mkdirSync,mkdtempSync,rmSync,copyFileSync,readdirSync,linkSync} from "node:fs";
import {dirname,basename,join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {parseArgs} from "node:util";
import {fileSha256,isMain} from "../../scripts/tooling.ts";
import {requireNewOutput} from "./build-driver-iso.ts";
const ROOT=fileURLToPath(new URL(".",import.meta.url));
type Pin={name:string;sha256:string;bytes?:number;signerThumbprint?:string;catalogVerified?:boolean;embeddedSignerThumbprint?:string};
type FileReport=Pin&{embeddedSignatureStatus?:string};
export type Report={signatureVerificationPassed:boolean;isoSha256:string;isoBytes:number;catalog:Record<string,unknown>;files:FileReport[];packages:(Pin&{key:string;signatureStatus:string})[]};
export const PIN=JSON.parse(readFileSync(join(ROOT,"driver-files.json"),"utf8")) as {iso:Pin;catalog:Pin;files:Pin[];winfsp:Pin};
export function check(path:string,spec:Pin){const s=lstatSync(path);assert(s.isFile()&&(spec.bytes===undefined||s.size===spec.bytes)&&fileSha256(path)===spec.sha256,"Pinned file differs: "+basename(path));}
export function verifyReport(r:Report){
 assert(r.signatureVerificationPassed===true&&r.isoSha256===PIN.iso.sha256&&r.isoBytes===PIN.iso.bytes,"Driver ISO qualification missing");
 assert(Object.entries(PIN.catalog).every(([k,v])=>r.catalog[k]===v),"Catalog identity mismatch");
 assert.deepEqual(r.files.map(x=>x.name).sort(),PIN.files.map(x=>x.name).sort(),"Unexpected report files");
 for(const spec of PIN.files){
  const f=r.files.find(x=>x.name===spec.name);assert(f&&f.sha256===spec.sha256&&f.bytes===spec.bytes,"Driver report differs");
  if(spec.catalogVerified)assert(f.catalogVerified===true,"Driver catalog membership missing");
  if(spec.embeddedSignerThumbprint)assert(f.embeddedSignatureStatus==="Valid"&&f.embeddedSignerThumbprint===spec.embeddedSignerThumbprint,"Service signature mismatch");
 }
 const pkg=r.packages.filter(x=>x.key==="winfsp");
 assert(pkg.length===1&&pkg[0].signatureStatus==="Valid"&&pkg[0].sha256===PIN.winfsp.sha256&&pkg[0].signerThumbprint===PIN.winfsp.signerThumbprint,"WinFsp signature mismatch");
}
export function build(iso:string,winfsp:string,report:string,output:string){
 verifyReport(JSON.parse(readFileSync(report,"utf8").replace(/^\uFEFF/,"")));check(iso,PIN.iso);check(winfsp,PIN.winfsp);requireNewOutput(output);
 mkdirSync(dirname(output),{recursive:true});const tmp=mkdtempSync(join(dirname(output),".catalog-"));
 try{
  const media=join(tmp,"media");mkdirSync(media);
  for(const spec of [PIN.catalog,...PIN.files]){const dst=join(media,spec.name);execFileSync("xorriso",["-osirrox","on","-indev",iso,"-extract","/viofs/2k22/amd64/"+spec.name,dst],{timeout:60000});check(dst,spec);}
  copyFileSync(winfsp,join(media,"winfsp.msi"));copyFileSync(join(ROOT,"bootstrap-catalog.ps1"),join(media,"bootstrap.ps1"));copyFileSync(join(ROOT,"driver-files.json"),join(media,"driver-files.json"));
  const tmpiso=join(tmp,"drivers.iso");execFileSync("xorriso",["-as","mkisofs","-quiet","-R","-J","-V","VMDRIVERS","-o",tmpiso,media],{timeout:120000});
  const extracted=join(tmp,"extracted");mkdirSync(extracted);execFileSync("xorriso",["-osirrox","on","-indev",tmpiso,"-extract","/",extracted],{timeout:60000});
  const hashes=(path:string)=>Object.fromEntries(readdirSync(path).map(n=>{const p=join(path,n);assert(lstatSync(p).isFile(),"Unexpected ISO member");return [n,fileSha256(p)];}));
  const expected=hashes(media);assert.deepEqual(hashes(extracted),expected,"ISO readback mismatch");linkSync(tmpiso,output);
  return {sha256:fileSha256(output),bytes:statSync(output).size,sizeGiB:1,readbackVerified:true,files:expected,guestCompatibilityVerified:false};
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
if(isMain(import.meta.url)){
 const {values:v}=parseArgs({options:{iso:{type:"string"},winfsp:{type:"string"},report:{type:"string"},output:{type:"string"},authorized:{type:"boolean"}}});
 assert(v.authorized&&v.iso&&v.winfsp&&v.report&&v.output,"Explicit authorized ISO inputs required");
 console.log(JSON.stringify(build(v.iso,v.winfsp,v.report,v.output),null,2));
}
