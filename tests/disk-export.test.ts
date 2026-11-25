import {test} from "node:test";
import assert from "node:assert/strict";
import {exportManifest,exportEndpoint,assertCold} from "../src/disk-export";
const id="vm-"+"a".repeat(32),name="vx-"+"b".repeat(32),claim=id+"-data-work",ns="vm-interface",service="virt-export-"+name;
test("native export manifest fixes source, owner, token and expiry",()=>{
 const m=exportManifest(id,"alpha","vmuid","work","pvcuid",name);
 assert.equal(m.spec.source.name,claim);assert.equal(m.spec.source.kind,"PersistentVolumeClaim");assert.equal(m.spec.tokenSecretRef,"vm-api-export");assert.equal(m.spec.ttlDuration,"15m0s");
 assert.throws(()=>exportManifest(id,"alpha","vmuid","../secrets","pvcuid",name));
});
test("export endpoint rejects alternate destinations, expired and unready state",()=>{
 const valid={phase:"Ready",ttlExpirationTime:new Date(Date.now()+60000).toISOString(),serviceName:service,tokenSecretRef:"vm-api-export",links:{internal:{cert:"-----BEGIN CERTIFICATE-----",volumes:[{name:claim,formats:[{format:"raw",url:"https://"+service+"."+ns+".svc/volumes/"+claim+"/disk.img"}]}]}}};
 assert.equal(exportEndpoint(name,ns,claim,valid).host,service+"."+ns+".svc");
 for(const wrong of ["https://example.com/disk.img","http://"+service+"."+ns+".svc/volumes/"+claim+"/disk.img"]){const v=structuredClone(valid);v.links.internal.volumes[0].formats[0].url=wrong;assert.throws(()=>exportEndpoint(name,ns,claim,v))}
 assert.throws(()=>exportEndpoint(name,ns,claim,{...valid,ttlExpirationTime:"2000-01-01T00:00:00Z"}));
 assert.throws(()=>exportEndpoint(name,ns,claim,{...valid,phase:"Pending"}));
});
test("native export requires converged halted VM",()=>{
 const vm={metadata:{uid:"vmuid"},spec:{runStrategy:"Halted"},status:{}};
 assert.doesNotThrow(()=>assertCold(vm,null));assert.throws(()=>assertCold(vm,{}));assert.throws(()=>assertCold({...vm,status:{created:true}},null));
});
