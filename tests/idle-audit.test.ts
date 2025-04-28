import {test} from "node:test";
import assert from "node:assert/strict";
import {idleSeconds,shouldIdleStop} from "../src/idle";
import {auditContext} from "../src/audit";
test("idle stop is opt-in and protects live sessions",()=>{
 assert.equal(idleSeconds({}),null);
 assert.equal(idleSeconds({metadata:{annotations:{"vm-interface.io/idle-stop-seconds":"60"}}}),60);
 assert.throws(()=>idleSeconds({metadata:{annotations:{"vm-interface.io/idle-stop-seconds":"0"}}}),/Invalid/);
 assert.equal(shouldIdleStop(0,60,59999,false),false);
 assert.equal(shouldIdleStop(0,60,60000,true),false);
 assert.equal(shouldIdleStop(0,60,60000,false),true);
});
test("audit keeps only sanitized route groups, never filenames, keys or bodies",()=>{
 const id="vm-"+"a".repeat(32);
 assert.deepEqual(auditContext("alpha","key","PUT",["computers",id,"files","secret-name"]),{account:"alpha",actor:"key",method:"PUT",group:"files",computerId:id});
 assert.equal(auditContext("alpha","key","GET",["secret-token"]).group,"other");
});
