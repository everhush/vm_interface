import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import {parseComputerRequest} from "../src/advanced-spec";
import {computerSpec,vmManifest} from "../src/spec";
const native={version:1,name:"native",image:"cirros-smoke",kubevirt:{architecture:"amd64",domain:{cpu:{cores:1},resources:{requests:{memory:"512Mi"}}}}};
const simple={version:1,name:"native",image:"cirros-smoke",architecture:"amd64",cpu:1,memoryMiB:512};
test("native field subset canonicalizes to the same account-owned manifest",()=>{
 const p=parseComputerRequest(native);
 assert.equal(p.success,true);if(!p.success)throw Error("invalid fixture");
 assert.deepEqual(p.data,computerSpec.parse(simple));
 assert.deepEqual(vmManifest("vm-test","alpha",p.data),vmManifest("vm-test","alpha",computerSpec.parse(simple)));
});
test("native schema rejects unsafe fields, overcommit and inconsistent networks",()=>{
 for(const change of [
  {...native,metadata:{namespace:"default"}},
  {...native,kubevirt:{...native.kubevirt,nodeSelector:{"kubernetes.io/arch":"arm64"}}},
  {...native,kubevirt:{...native.kubevirt,domain:{...native.kubevirt.domain,devices:{autoattachPodInterface:true,interfaces:[]}}}},
  {...native,kubevirt:{...native.kubevirt,domain:{...native.kubevirt.domain,cpu:{cores:8}}}},
  {...native,kubevirt:{...native.kubevirt,domain:{...native.kubevirt.domain,resources:{requests:{memory:"9999Mi"}}}}},
  {...native,kubevirt:{...native.kubevirt,volumes:[{hostDisk:{path:"/"}}]}},
 ])assert.equal(parseComputerRequest(change).success,false);
});
test("private native network maps to same existing restricted profile",()=>{
 const p=parseComputerRequest({...native,kubevirt:{...native.kubevirt,domain:{...native.kubevirt.domain,devices:{autoattachPodInterface:true,interfaces:[{name:"private",masquerade:{},model:"virtio"}]}},networks:[{name:"private",pod:{}}]}});
 assert.equal(p.success,true);if(!p.success)throw Error("invalid fixture");
 assert.deepEqual(p.data,computerSpec.parse({...simple,network:"private"}));
});
