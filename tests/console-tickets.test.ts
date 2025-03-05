import {test} from "node:test";
import assert from "node:assert/strict";
import {displayToken,validTicket} from "../src/console-tickets";
test("display credentials are distinct from account bearer credentials",()=>{
 const token="a".repeat(43);
 assert.equal(displayToken("Console "+token),token);
 assert.equal(displayToken("Bearer "+token),null);
 assert.equal(displayToken("Console "+token+"="),null);
 assert.equal(displayToken("Console short"),null);
});
test("display grants are strictly VM-bound, unexpired and unrevoked",()=>{
 const now=Date.now(),t={computerId:"vm",expiresAt:new Date(now+1),revokedAt:null};
 assert.equal(validTicket(t,"vm",now),true);
 assert.equal(validTicket(t,"other",now),false);
 assert.equal(validTicket(t,"vm",now+1),false);
 assert.equal(validTicket({...t,revokedAt:new Date(now)},"vm",now),false);
});
