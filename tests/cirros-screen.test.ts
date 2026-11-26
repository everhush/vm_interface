import {test} from "node:test";
import assert from "node:assert/strict";
import {cirrosNormalize,cirrosReady} from "../scripts/cirros-screen";
test("only the exact late entropy log can interrupt typed input",()=>{
 const observed="cirros login: autocitesthumanl  65.731613] random: nonblocking pool is initial\nzed\n\ncontrol_";
 assert.equal(cirrosNormalize(observed),"cirrosloginautocitesthumancontrol");
 assert.equal(cirrosNormalize("human[ 65.731613] random: nonblocking pool is initialized\ncontrol"),"humancontrol");
 assert.ok(cirrosNormalize(observed+"forbiddeninput").includes("forbiddeninput"));
 assert.ok(!cirrosNormalize("human arbitrary input control").includes("humancontrol"));
 assert.ok(!cirrosNormalize("human[65.731613] random: forbiddeninput control").includes("humancontrol"));
});
test("real prompt with optional entropy or bounded quiet grace",()=>{
 assert.equal(cirrosReady("cirros login:",89999),false);
 assert.equal(cirrosReady("cirros login:",90000),true);
 assert.equal(cirrosReady("cirros login:\n[65.731613] random: nonblocking pool is initialized",1000),true);
 assert.equal(cirrosReady("booting",100000),false);
});
