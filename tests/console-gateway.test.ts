import {test} from "node:test";
import assert from "node:assert/strict";
import {dimensionsOkay,gatewayTicket} from "../src/console-gateway";
test("gateway ticket is distinct and rejects ambiguous credentials",()=>{
 const t="a".repeat(43);
 assert.equal(gatewayTicket({headers:{authorization:"Console "+t}}),t);
 assert.equal(gatewayTicket({headers:{"sec-websocket-protocol":"binary, vm-ticket."+t}}),t);
 assert.equal(gatewayTicket({headers:{authorization:"Bearer "+t}}),null);
 assert.equal(gatewayTicket({headers:{authorization:"Console "+t,"sec-websocket-protocol":"binary, vm-ticket."+"b".repeat(43)}}),null);
 assert.equal(gatewayTicket({headers:{"sec-websocket-protocol":"vm-ticket."+t+", vm-ticket."+t}}),null);
});
test("gateway limits frame allocation",()=>{
 assert.equal(dimensionsOkay(640,480),true);
 assert.equal(dimensionsOkay(1920,1200),true);
 assert.equal(dimensionsOkay(8192,8192),false);
 assert.equal(dimensionsOkay(0,1),false);
});
