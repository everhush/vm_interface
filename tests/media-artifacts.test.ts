import {test} from "node:test";
import assert from "node:assert/strict";
import {artifactSpec,artifactCapacity,artifactLimits,artifactMatches,artifactReference} from "../src/media-artifacts";
const metadata={format:"raw" as const,bytes:4096,sha256:"a".repeat(64),source:"authorized source",os:"Linux",version:"1",authorizedByClient:true as const};
const spec={metadata,architecture:"amd64" as const,licensing:"client authorized"};
test("registered images require bounded explicit metadata, licensing and architecture",()=>{
 assert.ok(artifactSpec.safeParse(spec).success);
 assert.equal(artifactSpec.safeParse({...spec,metadata:{...metadata,authorizedByClient:false}}).success,false);
 assert.equal(artifactSpec.safeParse({...spec,licensing:""}).success,false);
 assert.equal(artifactSpec.safeParse({...spec,metadata:{...metadata,bytes:artifactLimits.maxBytes+1}}).success,false);
 assert.equal(artifactReference.safeParse({artifactId:"../../guest"}).success,false);
 assert.equal(artifactReference.safeParse({artifactId:"00000000-0000-0000-0000-000000000000",account:"other"}).success,false);
});
test("artifact quota and exact target match are fail closed",()=>{
 assert.doesNotThrow(()=>artifactCapacity([],"alpha",4096));
 assert.throws(()=>artifactCapacity(Array.from({length:8},()=>({account:"alpha",bytes:512})),"alpha",4096));
 assert.throws(()=>artifactCapacity(Array.from({length:4},()=>({account:"alpha",bytes:artifactLimits.maxBytes})),"alpha",4096));
 assert.throws(()=>artifactCapacity(Array.from({length:8},()=>({account:"beta",bytes:artifactLimits.maxBytes})),"alpha",4096));
 assert.ok(artifactMatches(spec,metadata,"amd64"));
 assert.equal(artifactMatches(spec,metadata,"arm64"),false);
 assert.equal(artifactMatches(spec,{...metadata,sha256:"b".repeat(64)},"amd64"),false);
 assert.equal(artifactMatches(spec,{...metadata,source:"other"},"amd64"),false);
});
