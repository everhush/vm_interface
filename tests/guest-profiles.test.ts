import {test} from "node:test";
import assert from "node:assert/strict";
import {computerSpec,vmManifest} from "../src/spec";
import {managedDisks} from "../src/storage";
import {desiredUsage,specUsage} from "../src/quota";
import {coldBootPatch} from "../src/boot";
const id="vm-"+"a".repeat(32);
const media={format:"raw",bytes:1048576,sha256:"a".repeat(64),source:"authorized prepared disk",os:"Android",version:"test",authorizedByClient:true};
const base={version:1,name:"arm-test",architecture:"arm64",cpu:2,memoryMiB:2048,image:"uploaded-disk",media,firmware:"uefi",storage:{systemGiB:4,exchangeGiB:1,exchangeMode:"virtiofs"}};
test("ARM profile is explicit UEFI and matches node architecture",()=>{
 const s=computerSpec.parse(base),m=vmManifest(id,"alpha",s);
 assert.equal(m.spec.template.spec.nodeSelector["kubernetes.io/arch"],"arm64");
 assert.equal(managedDisks(m,id)[1].mode,"virtiofs");
 assert.deepEqual(desiredUsage(m.spec),specUsage(s));
 for(const v of [{firmware:"bios"},{bootBus:"sata"},{image:"cirros-smoke",media:undefined},{image:"uploaded-installer",media:{...media,format:"iso"}}])assert.equal(computerSpec.safeParse({...base,...v}).success,false);
});
test("Windows installer can retain distinct VirtioFS exchange",()=>{
 const s=computerSpec.parse({...base,architecture:"amd64",image:"uploaded-installer",bootBus:"sata",media:{...media,format:"iso",os:"Windows"}});
 const m=vmManifest(id,"alpha",s),vm={...m,metadata:{...m.metadata,uid:"uid",resourceVersion:"5"},status:{}};
 assert.deepEqual(managedDisks(m,id).map(d=>d.kind),["boot","exchange","installer"]);
 assert.deepEqual(desiredUsage(m.spec),specUsage(s));
 assert.equal(coldBootPatch(vm,null,{first:"system",expectedResourceVersion:"5"}).spec.template.spec.domain.devices.disks.find(d=>d.name==="boot")?.bootOrder,1);
});
