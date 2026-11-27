import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import {bootSpec,coldBootPatch,bootPreference,installerTray} from "../src/boot";
import {vmManifest,type ComputerSpec} from "../src/spec";
import type {Resource} from "../src/kube";
const id="vm-"+"a".repeat(32);
const spec:ComputerSpec={version:1,name:"install",architecture:"amd64",cpu:2,memoryMiB:2048,image:"uploaded-installer",firmware:"uefi",bootBus:"sata",storage:{systemGiB:4,exchangeGiB:1},media:{format:"iso",bytes:1048576,sha256:"a".repeat(64),source:"authorized-test",os:"fixture",version:"1",authorizedByClient:true}};
const m=vmManifest(id,"owner",spec);
const vm:Resource={...m,metadata:{...m.metadata,uid:"uid",resourceVersion:"10"},status:{ready:false,created:false}};
const req={first:"system" as const,expectedResourceVersion:"10"};
test("cold installer boot switch preserves disk devices",()=>{
 assert.equal(bootPreference(vm),"installer");
 const patch=coldBootPatch(vm,null,req);
 assert.equal(patch.metadata.resourceVersion,"10");
 const disks=patch.spec.template.spec.domain.devices.disks;
 const original=m.spec.template.spec.domain.devices.disks;
 assert.equal(disks.find(d=>d.name==="boot")?.bootOrder,1);
 assert.equal(disks.find(d=>d.name==="installer")?.bootOrder,2);
 assert.deepEqual(disks.map(d=>{const copy={...d};delete copy.bootOrder;return copy}),original.map(d=>{const copy={...d};delete (copy as {bootOrder?:number}).bootOrder;return copy}));
 assert.equal(bootPreference(vm),"installer");
});
test("boot switch rejects arbitrary input, stale state, running and non-installer VMs",()=>{
 assert.equal(bootSpec.safeParse({...req,hostPath:"/"}).success,false);
 assert.throws(()=>coldBootPatch(vm,null,{...req,expectedResourceVersion:"9"}),/version changed/);
 assert.throws(()=>coldBootPatch(vm,{metadata:{uid:"running"}},req),/Stop the VM/);
 assert.throws(()=>coldBootPatch({...vm,status:{stateChangeRequests:[{}]}},null,req),/Stop the VM/);
 assert.throws(()=>coldBootPatch({...vm,spec:{runStrategy:"Halted"}},null,req),/Unsupported installer/);
});

test("cold optical media eject and reinsert preserve storage and other devices",()=>{
 assert.equal(installerTray(vm),"closed");
 assert.equal(bootSpec.safeParse({...req,first:"installer",installerTray:"open"}).success,false);
 const opened=coldBootPatch(vm,null,{...req,installerTray:"open"});
 const disks=opened.spec.template.spec.domain.devices.disks;
 assert.equal(disks.find(d=>d.name==="installer")?.cdrom?.tray,"open");
 assert.equal(disks.find(d=>d.name==="boot")?.bootOrder,1);
 assert.deepEqual(disks.find(d=>d.name==="exchange"),m.spec.template.spec.domain.devices.disks.find(d=>d.name==="exchange"));
 const changed={...vm,spec:{...m.spec,template:{...m.spec.template,spec:{...m.spec.template.spec,domain:{...m.spec.template.spec.domain,devices:{...m.spec.template.spec.domain.devices,disks}}}}}};
 assert.equal(installerTray(changed),"open");
 assert.throws(()=>coldBootPatch(changed,null,{...req,first:"installer"}),{status:422});
 const reinserted=coldBootPatch(changed,null,{...req,first:"installer",installerTray:"closed"});
 assert.equal(reinserted.spec.template.spec.domain.devices.disks.find(d=>d.name==="installer")?.cdrom?.tray,"closed");
});
