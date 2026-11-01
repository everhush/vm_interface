import {test} from "node:test";
import assert from "node:assert/strict";
import {vmManifest,type ComputerSpec} from "../src/spec";
import {coldDataDiskPatch,readDataDisks,DATA_DISKS_ANNOTATION,dataDiskClaim} from "../src/data-disk-layout";
import {dataDiskSpec,dataDiskManifest} from "../src/data-disks";
import {desiredUsage} from "../src/quota";
import {managedDisks} from "../src/storage";
import type {Resource} from "../src/kube";
const id="vm-"+"a".repeat(32),uid="test-uid",rv="3";
const spec:ComputerSpec={version:1,name:"disk-test",architecture:"amd64",cpu:1,memoryMiB:512,image:"cirros-smoke",storage:{systemGiB:2,exchangeGiB:1}};
function vm():Resource{const m=vmManifest(id,"alpha",spec);return {...m,metadata:{...m.metadata,uid,resourceVersion:rv}}}
function apply(vm:Resource,r:ReturnType<typeof coldDataDiskPatch>){
 const s=vm.spec as {template:{metadata:{annotations?:Record<string,string>};spec:{domain:{devices:{disks:unknown[]}};volumes:unknown[]}}};
 s.template.metadata.annotations={...s.template.metadata.annotations,...r.patch.spec.template.metadata.annotations};
 s.template.spec.domain.devices.disks=r.patch.spec.template.spec.domain.devices.disks;
 s.template.spec.volumes=r.patch.spec.template.spec.volumes;
}
test("create, attach and detach keep reservation and disk identity; only attached data disk enters VM volumes",()=>{
 const v=vm(),create=coldDataDiskPatch(v,null,id,{action:"create",name:"work",sizeGiB:2,expectedResourceVersion:rv});apply(v,create);
 assert.equal(desiredUsage(v.spec).storageGiB,5);
 assert.deepEqual(readDataDisks(v,id),[{name:"work",sizeGiB:2,attached:false}]);
 assert.equal(managedDisks(v,id).find(d=>d.kind==="data")?.name,dataDiskClaim(id,"work"));
 assert.equal(create.patch.spec.template.spec.volumes.some(x=>x.name==="data-work"),false);
 apply(v,coldDataDiskPatch(v,null,id,{action:"attach",name:"work",expectedResourceVersion:rv}));
 assert.equal(readDataDisks(v,id)[0].attached,true);
 assert.equal(desiredUsage(v.spec).storageGiB,5);
 apply(v,coldDataDiskPatch(v,null,id,{action:"detach",name:"work",expectedResourceVersion:rv}));
 assert.equal(readDataDisks(v,id)[0].attached,false);assert.equal(desiredUsage(v.spec).storageGiB,5);
 assert.equal(managedDisks(v,id).filter(d=>d.kind==="data").length,1);
});
test("reject running, stale, duplicate, malformed, unregistered and traversal disk requests",()=>{
 const v=vm(),r={action:"create" as const,name:"work",sizeGiB:1,expectedResourceVersion:rv};
 assert.throws(()=>coldDataDiskPatch(v,{},id,r),/Stop the VM/);
 assert.throws(()=>coldDataDiskPatch(v,null,id,{...r,expectedResourceVersion:"old"}),/resource version/);
 assert.equal(dataDiskSpec.safeParse({...r,name:"../foreign"}).success,false);
 assert.equal(dataDiskSpec.safeParse({...r,sizeGiB:9}).success,false);
 assert.equal(dataDiskSpec.safeParse({...r,claimName:"other-account"}).success,false);
 apply(v,coldDataDiskPatch(v,null,id,r));
 assert.throws(()=>coldDataDiskPatch(v,null,id,r),/name exists/);
 assert.throws(()=>coldDataDiskPatch(v,null,id,{action:"detach",name:"absent",expectedResourceVersion:rv}),/not found/);
 const s=v.spec as {template:{metadata:{annotations:Record<string,string>}}};s.template.metadata.annotations[DATA_DISKS_ANNOTATION]='[{"name":"work","sizeGiB":1,"attached":true}]';
 assert.throws(()=>readDataDisks(v,id),/Unrecognized/);
});
test("blank CDI disk manifest has fixed namespace-independent name, owner, storage and no import URL",()=>{
 const m=dataDiskManifest(id,"alpha",uid,{name:"work",sizeGiB:2,attached:false});
 assert.equal(m.metadata.name,id+"-data-work");assert.equal(m.metadata.ownerReferences[0].uid,uid);
 assert.deepEqual(m.spec.source,{blank:{}});assert.equal(m.spec.storage.resources.requests.storage,"2Gi");
});
