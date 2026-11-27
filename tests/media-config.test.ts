import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import {boundedInteger,installerGiB,GiB,MiB,mediaMaxBytes,systemMaxGiB} from "../src/media-config";
import {computerSpec,vmManifest} from "../src/spec";
import {specUsage,desiredUsage} from "../src/quota";
test("operator capacity defaults and strict bounds",()=>{
 assert.equal(boundedInteger(undefined,64,64,8192,"test"),64);
 for(const bad of ["0","1e3","-1","8193","foo"," 64"])assert.throws(()=>boundedInteger(bad,64,64,8192,"test"));
 assert.equal(boundedInteger("8192",64,64,8192,"test"),8192);
 assert.equal(installerGiB(64*MiB),1);
 assert.ok(installerGiB(5*GiB)>5);
 assert.throws(()=>installerGiB(9*GiB));
 assert.ok(mediaMaxBytes>=64*MiB&&systemMaxGiB>=8);
});
test("installer capacity and SATA disk bus are included in desired quota",()=>{
 const s=computerSpec.parse({version:1,name:"iso",architecture:"amd64",cpu:2,memoryMiB:1024,image:"uploaded-installer",bootBus:"sata",storage:{systemGiB:2,exchangeGiB:1},media:{format:"iso",bytes:64*MiB,sha256:"a".repeat(64),source:"fixture",os:"test",version:"1",authorizedByClient:true}});
 const m=vmManifest("vm-"+"b".repeat(32),"alpha",s);
 const boot=m.spec.template.spec.domain.devices.disks[0];
 assert.ok("disk" in boot);assert.equal(boot.disk?.bus,"sata");
 assert.deepEqual(specUsage(s),desiredUsage(m.spec));
 assert.equal(specUsage(s).storageGiB,4);
 assert.equal(computerSpec.safeParse({...s,image:"cirros-smoke",media:undefined}).success,false);
});
