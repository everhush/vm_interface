import {test} from "node:test";
import assert from "node:assert/strict";
import {PENDING_TIMEOUT_MS,pendingIsStale,replaySubmission} from "../src/operation";

test("in-flight idempotency submissions expire to unknown without replay",()=>{
 const now=Date.parse("2026-11-24T00:00:00.000Z");
 assert.equal(pendingIsStale(new Date(now-PENDING_TIMEOUT_MS+1),now),false);
 assert.equal(pendingIsStale(new Date(now-PENDING_TIMEOUT_MS-1),now),true);
 assert.equal(pendingIsStale(new Date(now-2*PENDING_TIMEOUT_MS),now),true);
 assert.equal(pendingIsStale("not-a-timestamp",now),true);
});

test("rejected idempotent replay preserves HTTP failure and never becomes accepted",()=>{
 for(const httpStatus of [400,404,409,422]){
  assert.throws(()=>replaySubmission({id:"op",status:"rejected",result:{error:"Denied",httpStatus}}),{status:httpStatus,message:"Denied"});
 }
 assert.throws(()=>replaySubmission({id:"op",status:"rejected",result:{error:"Legacy"}}),{status:409,message:"Legacy"});
 assert.deepEqual(replaySubmission({id:"op",status:"submitted",result:{id:"vm"}}),{operationId:"op",status:"submitted",result:{id:"vm"}});
 assert.equal(replaySubmission({id:"op",status:"unknown",result:null}).status,"unknown");
});
