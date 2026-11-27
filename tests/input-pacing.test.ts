import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import {pacedInputBatch,INPUT_EVENT_DWELL_MS} from "../src/input-batch";
test("paced input does not coalesce button down/up and waits after final event",async()=>{
 const trace:(string|number)[]=[];
 await pacedInputBatch(["move","down","up"],async event=>{trace.push(event)},async ms=>{trace.push(ms)});
 assert.deepEqual(trace,["move",INPUT_EVENT_DWELL_MS,"down",INPUT_EVENT_DWELL_MS,"up",INPUT_EVENT_DWELL_MS]);
 assert.ok(INPUT_EVENT_DWELL_MS>=30);
});
test("failed authority fence stops subsequent events, no automatic replay",async()=>{
 const sent:number[]=[];
 await assert.rejects(pacedInputBatch([1,2,3],async (event)=>{if(event===2)throw Error("revoked");sent.push(event)},async()=>{}),/revoked/);
 assert.deepEqual(sent,[1]);
});
