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

import {safeIntent} from "../src/operation";
import {lifecycleObservation} from "../src/reconcile-operation";
test("durable intent never persists console input or credentials",()=>{
 const id="12345678-1234-1234-1234-123456789abc";
 const vm="vm-"+"a".repeat(32);
 assert.deepEqual(safeIntent({action:"input",id:vm,batch:{events:[{text:"secret"}]},token:"secret"},id),{action:"input",computerId:vm});
 assert.deepEqual(safeIntent({action:"create",spec:{cloudInit:"secret"}},id),{action:"create",computerId:"vm-12345678123412341234123456789abc"});
});
test("restart observation requires a distinct VMI and verified VM identity",()=>{
 const vm={metadata:{uid:"vm-uid"},status:{}};
 const old={metadata:{uid:"old"},status:{phase:"Running"}};
 const next={metadata:{uid:"new"},status:{phase:"Running"}};
 const target={vmUid:"vm-uid",previousInstanceUid:"old"};
 assert.equal(lifecycleObservation("restart",vm,old,target).state,"waiting");
 assert.equal(lifecycleObservation("restart",vm,next,target).state,"converged");
 assert.equal(lifecycleObservation("restart",vm,next,{vmUid:"other"}).state,"uncertain");
 assert.equal(lifecycleObservation("restart",vm,next,{vmUid:"vm-uid"}).state,"uncertain");
 assert.equal(lifecycleObservation("stop",vm,null,target).state,"converged");
 assert.equal(lifecycleObservation("delete",null,null,target).state,"waiting");
});

import {requireIdempotencyKey} from "../src/operation";
test("receipt lookup uses the same bounded key syntax as submission",()=>{assert.equal(requireIdempotencyKey("exact-key-123"),"exact-key-123");for(const k of [null,"short","bad key!!","a".repeat(129)])assert.throws(()=>requireIdempotencyKey(k),{status:400});});
