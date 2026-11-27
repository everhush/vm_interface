import {test} from "vite-plus/test";
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
 assert.equal(cirrosReady("cirros login:",179999),false);
 assert.equal(cirrosReady("cirros login:",180000),true);
 assert.equal(cirrosReady("cirros login:\n[65.731613] random: nonblocking pool is initialized",1000),true);
 assert.equal(cirrosReady("booting",100000),false);
});

test("actual late 99-second control marker OCR bracket",()=>{assert.ok(cirrosNormalize("cirros login: scriptst£ 99.340024] random: nonblocking pool is initialized\nart_").includes("scriptstart"));assert.ok(!cirrosNormalize("scriptst£ 99.340024] random: forbiddeninput pool is initialized\nart_").includes("scriptstart"))});

test("retained 181-second automation marker interleave with f/1 OCR delimiters",()=>{
 const observed="cirros login: af 181.5210601 random: nonblocking pool is initialized\nutocitest_";
 assert.equal(cirrosNormalize(observed),"cirrosloginautocitest");
 assert.equal(cirrosNormalize(observed+"forbiddeninputobserverinput"),"cirrosloginautocitestforbiddeninputobserverinput");
 assert.ok(!cirrosNormalize("af 181.5210601 random: forbiddeninput pool is initialized\nutocitest").includes("autocitest"));
 assert.ok(!cirrosNormalize("af 181.5210601 random: nonblocking pool is initializedsuffix\nutocitest").includes("autocitest"));
});
