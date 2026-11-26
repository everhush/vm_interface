import {test} from "node:test";
import assert from "node:assert/strict";
import {computerSpec,vmManifest} from "../src/spec";
import {accountFor} from "../src/auth";
const sample={version:1,name:"test",architecture:"amd64",cpu:1,memoryMiB:512,image:"cirros-smoke"} as const;
test("strict spec rejects privilege and out-of-range resources",()=>{assert.equal(computerSpec.safeParse({...sample,hostPath:"/"}).success,false);assert.equal(computerSpec.safeParse({...sample,cpu:99}).success,false);assert.equal(computerSpec.safeParse(sample).success,true);});
test("manifest is halted, labelled and native-architecture constrained",()=>{const m=vmManifest("vm-test","tenant-a",sample);assert.equal(m.spec.runStrategy,"Halted");assert.equal(m.spec.template.spec.nodeSelector["kubernetes.io/arch"],"amd64");assert.equal(m.metadata.labels["vm-interface.io/account"],"tenant-a");assert.equal(m.spec.template.spec.domain.devices.autoattachPodInterface,false);});
test("test bearer derives account, not caller input",()=>{const token="a".repeat(40), config=JSON.stringify({alpha:token,beta:"b".repeat(40)});assert.equal(accountFor("Bearer "+token,config),"alpha");assert.equal(accountFor("Bearer "+"x".repeat(40),config),null);assert.equal(accountFor(null,config),null);});

import {acceptFor,actionPath,vmPath} from "../src/kube";
test("KubeVirt lifecycle requests accept empty responses without JSON negotiation",()=>{for(const action of ["start","stop","restart"])assert.equal(acceptFor("PUT",actionPath("vm-test",action)),"*/*");assert.equal(acceptFor("GET",vmPath()),"application/json");assert.equal(acceptFor("POST",vmPath()),"application/json");});

import {managedDisks,hasOwner,requireDeleteConfirmation} from "../src/storage";
test("persistent manifest uses two owned CDI templates and never accepts arbitrary sources",()=>{
 const parsed=computerSpec.parse({...sample,storage:{systemGiB:2,exchangeGiB:1}});
 const id="vm-"+"a".repeat(32), m=vmManifest(id,"alpha",parsed);
 const templates=m.spec.dataVolumeTemplates!;
 assert.equal(templates.length,2);
 assert.equal(templates[0].metadata.name,id+"-boot");
 assert.deepEqual(templates[0].spec.source,{registry:{url:"docker://quay.io/kubevirt/cirros-container-disk-demo@sha256:0e5ac38b20abcc7752293425b239a147868facd62cd5030dede6da6f2fc526a1"}});
 assert.deepEqual(templates[1].spec.source,{blank:{}});
 assert.equal(templates[0].spec.storage.resources.requests.storage,"2Gi");
 assert.equal(templates[1].metadata.labels["vm-interface.io/account"],"alpha");
 assert.equal(m.spec.template.spec.volumes.length,2);
 assert.equal(computerSpec.safeParse({...sample,storage:{systemGiB:2,exchangeGiB:1,url:"http://169.254.169.254"}}).success,false);
 assert.equal(computerSpec.safeParse({...sample,storage:{systemGiB:100,exchangeGiB:1}}).success,false);
 const disks=managedDisks(m,id);
 assert.equal(disks.length,2);
 assert.throws(()=>requireDeleteConfirmation(disks,false),/explicitly confirm/);
 assert.doesNotThrow(()=>requireDeleteConfirmation(disks,true));
 assert.doesNotThrow(()=>requireDeleteConfirmation([],false));
 assert.throws(()=>managedDisks({spec:{dataVolumeTemplates:[{metadata:{name:"other-account"}}]}},id),/Unrecognized/);
 assert.equal(hasOwner({metadata:{ownerReferences:[{kind:"VirtualMachine",uid:"vm-uid"}]}},"VirtualMachine","vm-uid"),true);
 assert.equal(hasOwner({metadata:{ownerReferences:[{kind:"VirtualMachine",uid:"other"}]}},"VirtualMachine","vm-uid"),false);
 assert.equal(hasOwner({},"VirtualMachine",undefined),false);
});

test("authorized ARM64 share tag preserves the platform exchange claim",()=>{
 const id="vm-"+"a".repeat(32);
 const value={...sample,architecture:"arm64",image:"uploaded-disk",firmware:"uefi",media:{format:"qcow2",bytes:512,sha256:"a".repeat(64),source:"test",os:"Android",version:"test",authorizedByClient:true},storage:{systemGiB:2,exchangeGiB:1,exchangeMode:"virtiofs",exchangeTag:"share"}};
 const m=vmManifest(id,"alpha",computerSpec.parse(value));
 assert.deepEqual(m.spec.template.spec.domain.devices.filesystems,[{name:"share",virtiofs:{}}]);
 assert.ok(m.spec.template.spec.volumes.some(v=>v.name==="share"&&"persistentVolumeClaim" in v&&v.persistentVolumeClaim?.claimName===id+"-exchange"));
 assert.equal(managedDisks(m,id)[1].name,id+"-exchange");
 assert.equal(computerSpec.safeParse({...value,architecture:"amd64"}).success,false);
 assert.equal(computerSpec.safeParse({...value,storage:{...value.storage,exchangeMode:"block"}}).success,false);
 assert.equal(computerSpec.safeParse({...value,storage:{...value.storage,exchangeTag:"host"}}).success,false);
});

test("inline cloud-init matches pinned KubeVirt UTF-8 byte limit",()=>{
 const fedora={...sample,image:"fedora-exchange-test",memoryMiB:1536,storage:{systemGiB:4,exchangeGiB:1,exchangeMode:"virtiofs"}};
 assert.equal(computerSpec.safeParse({...fedora,cloudInit:"a".repeat(2048)}).success,true);
 assert.equal(computerSpec.safeParse({...fedora,cloudInit:"a".repeat(2049)}).success,false);
 assert.equal(computerSpec.safeParse({...fedora,cloudInit:"é".repeat(1025)}).success,false);
});
