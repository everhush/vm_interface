import {test} from "node:test";
import assert from "node:assert/strict";
import {computerSpec,vmManifest} from "../src/spec";
import {mediaDeclaration,validMediaHeader} from "../src/media";
import {desiredUsage} from "../src/quota";
const metadata={format:"iso",bytes:65536,sha256:"a".repeat(64),source:"authorized local fixture",os:"test",version:"1",authorizedByClient:true};
const spec={version:1,name:"media",architecture:"amd64",image:"uploaded-installer",cpu:1,memoryMiB:512,storage:{systemGiB:2,exchangeGiB:1},media:metadata,firmware:"uefi"};
test("installer media is separate readonly SATA CDROM and quota counted",()=>{
 const id="vm-"+"a".repeat(32),m=vmManifest(id,"alpha",computerSpec.parse(spec));
 assert.equal(mediaDeclaration(m,id)?.slot,"installer");
 assert.equal(m.spec.dataVolumeTemplates?.length,3);
 assert.equal(desiredUsage(m.spec).storageGiB,4);
 const d=m.spec.template.spec.domain.devices.disks.find(x=>x.name==="installer");
 assert.ok(d&&"cdrom" in d&&d.cdrom?.readonly);
 assert.equal(computerSpec.safeParse({...spec,media:{...metadata,authorizedByClient:false}}).success,false);
 assert.equal(computerSpec.safeParse({...spec,media:{...metadata,format:"qcow2"}}).success,false);
});
test("media format header checks are bounded and reject mismatches",()=>{
 const iso=Buffer.alloc(65536);iso.write("CD001",16*2048+1);
 assert.equal(validMediaHeader("iso",iso),true);
 assert.equal(validMediaHeader("raw",iso),false);
 const qcow=Buffer.alloc(104);qcow.writeUInt32BE(0x514649fb);qcow.writeUInt32BE(3,4);
 assert.equal(validMediaHeader("qcow2",qcow),true);
 qcow.writeBigUInt64BE(128n,8);assert.equal(validMediaHeader("qcow2",qcow),false);qcow.writeBigUInt64BE(0n,8);
 qcow.writeBigUInt64BE(4n,72);assert.equal(validMediaHeader("qcow2",qcow),false);
 assert.equal(validMediaHeader("qcow2",Buffer.alloc(512)),false);
});
