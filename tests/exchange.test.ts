import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {publish,download,listFiles} from "../src/exchange-files";
import {exchangeFileName,exchangePod,exchangePVC} from "../src/exchange";
import {computerSpec,vmManifest} from "../src/spec";
import {desiredUsage} from "../src/quota";
import {managedDisks} from "../src/storage";
const digest=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
test("VirtioFS uses distinct owned PVC and counts all reservations",()=>{
 const id="vm-"+"a".repeat(32);
 const s=computerSpec.parse({version:1,name:"test",architecture:"amd64",image:"fedora-exchange-test",cpu:1,memoryMiB:1536,storage:{systemGiB:4,exchangeGiB:1,exchangeMode:"virtiofs"}});
 const m=vmManifest(id,"alpha",s);
 assert.equal(m.spec.dataVolumeTemplates?.length,1);
 assert.equal(desiredUsage(m.spec).storageGiB,5);
 assert.equal(managedDisks(m,id)[1].mode,"virtiofs");
 const p=exchangePod(id,"alpha","uid","a".repeat(43));
 assert.equal(p.spec.automountServiceAccountToken,false);
 assert.equal(p.spec.volumes[0].persistentVolumeClaim.claimName,id+"-exchange");
 assert.equal(exchangePVC(id,"alpha","uid","1").metadata.ownerReferences[0].uid,"uid");
 assert.equal(computerSpec.safeParse({...s,image:"cirros-smoke"}).success,false);
});
test("exchange accepts bytes only with checksum and refuses symlinks, traversal and incomplete output",async()=>{
 const root=await mkdtemp(join(tmpdir(),"vm-exchange-"));
 try{
  const data=Buffer.from([0,1,2,255,10]);
  await publish(root,"hello.bin",data,digest(data));
  await publish(root,"hello.bin",data,digest(data));
  await assert.rejects(()=>publish(root,"hello.bin",Buffer.from("x"),digest(Buffer.from("x"))),{status:409});
  await assert.rejects(()=>publish(root,"bad",data,"0".repeat(64)),{status:422});
  assert.throws(()=>exchangeFileName("../x"),{status:422});
  await writeFile(join(root,"out-reply"),data);
  await assert.rejects(()=>download(root,"reply"),{status:404});
  await writeFile(join(root,"out-reply.sha256"),digest(data));
  assert.deepEqual((await download(root,"reply")).bytes,data);
  await symlink("/etc/passwd",join(root,"out-secret"));
  await writeFile(join(root,"out-secret.sha256"),digest(data));
  await assert.rejects(()=>download(root,"secret"),{status:404});
  assert.deepEqual((await listFiles(root)).map(x=>x.name),["reply"]);
 }finally{await rm(root,{recursive:true,force:true})}
});
