import {test} from "node:test";
import assert from "node:assert/strict";
import {accountFor} from "../src/auth";
const secret="a".repeat(32);
test("test identities require valid bearer and exact secret",()=>{
 assert.equal(accountFor("Bearer "+secret,JSON.stringify({alpha:secret,beta:"b".repeat(32)})),"alpha");
 assert.equal(accountFor("Bearer "+"c".repeat(32),JSON.stringify({alpha:secret})),null);
 assert.equal(accountFor(null,JSON.stringify({alpha:secret})),null);
});
test("duplicate or malformed identity configuration fails closed even after a match",()=>{
 assert.throws(()=>accountFor("Bearer "+secret,JSON.stringify({alpha:secret,beta:secret})),/Duplicate/);
 assert.throws(()=>accountFor("Bearer "+secret,JSON.stringify({alpha:secret,beta:"short"})),/Invalid/);
});
