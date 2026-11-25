import {test} from "node:test";
import assert from "node:assert/strict";
import {boundedBody,boundedText} from "../src/request-body";
test("body limits use actual UTF-8 bytes and reject oversized requests",async()=>{
 const req=(body:string)=>new Request("http://test/",{method:"POST",body});
 assert.equal(await boundedText(req("abc"),3),"abc");
 await assert.rejects(boundedBody(req("éé"),3),{status:413});
 await assert.rejects(boundedBody(new Request("http://test/",{method:"POST",body:"a",headers:{"content-length":"4"}}),3),{status:413});
});
test("stalled streams are cancelled at deadline",async()=>{
 const req=new Request("http://test/",{method:"POST",body:new ReadableStream({start(){/* deliberately never produce data */}}),duplex:"half"} as RequestInit);
 await assert.rejects(boundedBody(req,10,20),{status:400});
});
