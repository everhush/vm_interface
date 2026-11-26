import {test} from "node:test";
import assert from "node:assert/strict";
import {onceSuccessful} from "../src/once-successful";
test("migration is single-flight, retries failure and caches only success",async()=>{
 let calls=0;
 const run=onceSuccessful(async()=>{calls++;if(calls===1)throw Error("database unavailable")});
 const first=run(),same=run();assert.equal(first,same);
 await assert.rejects(first,/unavailable/);
 const retry=run();assert.equal(retry,run());await retry;
 await run();assert.equal(calls,2);
});
