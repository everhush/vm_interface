import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PIN,verifyReport,type Report} from "../showcases/windows/build-catalog-iso.ts";
import {MSI_MAGIC,stagePackage} from "../showcases/windows/build-driver-iso.ts";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
function fixture():Report{return {signatureVerificationPassed:true,isoSha256:PIN.iso.sha256,isoBytes:PIN.iso.bytes!,catalog:{...PIN.catalog},files:PIN.files.map(f=>({...f,...(f.embeddedSignerThumbprint?{embeddedSignatureStatus:"Valid"}:{})})),packages:[{...PIN.winfsp,key:"winfsp",signatureStatus:"Valid"}]};}
test("exact pinned catalog report",()=>verifyReport(fixture()));
test("reject wrong catalog/report inputs",()=>{
 const changes:((r:Report)=>void)[]=[r=>{r.isoSha256="0".repeat(64);},r=>{r.catalog.sha256="0".repeat(64);},r=>{r.files[0].sha256="0".repeat(64);},r=>{r.files.find(x=>x.name==="viofs.sys")!.catalogVerified=false;},r=>{r.files.find(x=>x.name==="virtiofs.exe")!.embeddedSignatureStatus="NotSigned";},r=>{r.packages[0].signerThumbprint="0".repeat(40);},r=>{r.files.push({...r.files[0]});},r=>{r.signatureVerificationPassed=false;}];
 for(const change of changes){const r=fixture();change(r);assert.throws(()=>verifyReport(r));}
});
function temp(fn:(dir:string)=>void){const dir=mkdtempSync(join(tmpdir(),"windows-iso-"));try{fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
test("MSI stage preserves pinned bytes and signer",()=>temp(dir=>{const source=join(dir,"source.msi"),dest=join(dir,"staged.msi"),data=Buffer.concat([MSI_MAGIC,Buffer.from("fixture")]);writeFileSync(source,data);assert.deepEqual(stagePackage(source,dest,sha(data),"a".repeat(40)),{name:"staged.msi",bytes:data.length,sha256:sha(data),signerThumbprint:"A".repeat(40)});assert.deepEqual(readFileSync(dest),data);}));
test("MSI stage rejects wrong digest, header and symlink",()=>temp(dir=>{const source=join(dir,"source.msi");writeFileSync(source,Buffer.concat([MSI_MAGIC,Buffer.from("fixture")]));assert.throws(()=>stagePackage(source,join(dir,"wrong.msi"),"0".repeat(64),"a".repeat(40)),/SHA256 mismatch/);writeFileSync(source,"not an MSI");assert.throws(()=>stagePackage(source,join(dir,"header.msi"),"0".repeat(64),"a".repeat(40)),/header/);const link=join(dir,"linked.msi");symlinkSync(source,link);assert.throws(()=>stagePackage(link,join(dir,"out.msi"),"0".repeat(64),"a".repeat(40)),/regular/);}));
